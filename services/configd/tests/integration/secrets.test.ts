import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import type {
  PublishSecretRequest
} from "../generated/v1/configd.js";
import {
  getConfigdTestContext
} from "../suite/get-configd-test-context.js";
import {
  createConsumerBinding
} from "../support/bindings/create-consumer-binding.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  createSecretRequest
} from "../support/secrets/create-secret-request.js";
import {
  getSecretMetadata
} from "../support/secrets/get-secret-metadata.js";
import {
  publishSecret
} from "../support/secrets/publish-secret.js";

test("publishes arbitrary secret material and returns metadata in every scope",
  async () => {
    const context = getConfigdTestContext();
    const cases = [
      {
        suffix: "global",
        scope: { kind: "global" as const }
      },
      {
        suffix: "tenant",
        scope: {
          kind: "tenant" as const,
          tenantId: "secret_tenant"
        }
      },
      {
        suffix: "workspace",
        scope: {
          kind: "workspace" as const,
          tenantId: "secret_tenant",
          workspaceId: "secret_workspace"
        }
      },
      {
        suffix: "user",
        scope: {
          kind: "user" as const,
          tenantId: "secret_tenant",
          accountPrincipalId: "service:automation"
        }
      }
    ];

    for (const current of cases) {
      const request = createSecretRequest({
        secretId: `secret_${current.suffix}`,
        placementId: `secret_placement_${current.suffix}`,
        consumerId: `secret_consumer_${current.suffix}`,
        purpose: "api_credential",
        scope: current.scope,
        material: Buffer.from([0x00, 0xff, 0x10, 0x80])
      });
      const published = await publishSecret(context.client, request);
      assert.equal(published.secret?.secretId, request.secretId);
      assert.equal(published.secret?.revision, 1n);
      assert.equal(
        published.secret?.currentSecretVersionId,
        request.secretVersionId);
      assert.deepEqual(published.secret?.binding, request.binding);
      assert.equal(
        published.version?.secretVersionId,
        request.secretVersionId);
      assert.ok(published.version?.createdAt instanceof Date);

      const loaded = await getSecretMetadata(context.client, {
        secretId: request.secretId,
        binding: request.binding
      });
      assert.deepEqual(loaded.secret, published.secret);
      assert.deepEqual(loaded.currentVersion, published.version);
      assert.equal("material" in loaded, false);
    }
  });

test("encrypts secret material without retaining plaintext or a digest",
  async () => {
    const context = getConfigdTestContext();
    const material = Buffer.from(
      "plaintext-that-must-not-be-persisted",
      "utf8");
    const request = createSecretRequest({
      secretId: "secret_encryption",
      material
    });
    await publishSecret(context.client, request);
    const row = await context.database.connection("secret_versions")
      .where({
        secret_version_id: request.secretVersionId
      })
      .first() as Record<string, unknown>;

    assert.deepEqual(
      Object.keys(row).sort(),
      [
        "audit_event_id",
        "authentication_tag",
        "ciphertext",
        "created_at_unix_ms",
        "dependency_claim_id",
        "dependency_claim_revision",
        "encryption_key_id",
        "material_length",
        "nonce",
        "request_expected_revision",
        "secret_id",
        "secret_version_id"
      ]);
    assert.equal(row.material_length, material.length);
    assert.ok(Buffer.isBuffer(row.ciphertext));
    assert.equal(
      (row.ciphertext as Buffer).equals(material),
      false);
    assert.equal((row.nonce as Buffer).length, 12);
    assert.equal((row.authentication_tag as Buffer).length, 16);
    assert.equal(
      JSON.stringify(row).includes(material.toString("utf8")),
      false);
  });

test("appends and exactly replays secret versions", async () => {
  const context = getConfigdTestContext();
  const first = createSecretRequest({
    secretId: "secret_versions",
    material: Buffer.from("first", "utf8")
  });
  const created = await publishSecret(context.client, first);
  const second = createSecretRequest({
    secretId: first.secretId,
    secretVersionId: "secret_versions_v2",
    expectedRevision: 1n,
    material: Buffer.from("second", "utf8")
  });
  const changed = await publishSecret(context.client, second);
  assert.equal(created.secret?.revision, 1n);
  assert.equal(changed.secret?.revision, 2n);
  assert.equal(
    changed.secret?.currentSecretVersionId,
    second.secretVersionId);
  assert.deepEqual(
    await publishSecret(context.client, second),
    changed);
  assert.deepEqual(
    await getSecretMetadata(context.client, {
      secretId: first.secretId,
      binding: first.binding
    }),
    {
      secret: changed.secret,
      currentVersion: changed.version
    });
});

test("enforces secret create, revision, binding, and replay rules",
  async () => {
    const context = getConfigdTestContext();
    const first = createSecretRequest({
      secretId: "secret_conflicts"
    });
    await publishSecret(context.client, first);

    await assert.rejects(
      publishSecret(context.client, {
        ...first,
        secretVersionId: "secret_conflicts_other"
      }),
      matchGrpcStatus(status.ALREADY_EXISTS));
    await assert.rejects(
      publishSecret(
        context.client,
        createSecretRequest({
          secretId: first.secretId,
          secretVersionId: first.secretVersionId,
          material: Buffer.from("different", "utf8")
        })),
      matchGrpcStatus(status.ALREADY_EXISTS));
    await assert.rejects(
      publishSecret(
        context.client,
        createSecretRequest({
          secretId: first.secretId,
          secretVersionId: "secret_conflicts_v2",
          expectedRevision: 9n
        })),
      matchGrpcStatus(status.ABORTED));
    await assert.rejects(
      publishSecret(
        context.client,
        createSecretRequest({
          secretId: "secret_absent_update",
          expectedRevision: 1n
        })),
      matchGrpcStatus(status.NOT_FOUND));
    await assert.rejects(
      publishSecret(
        context.client,
        createSecretRequest({
          secretId: first.secretId,
          secretVersionId: "secret_wrong_binding_v2",
          expectedRevision: 1n,
          consumerId: "another_consumer"
        })),
      matchGrpcStatus(status.NOT_FOUND));
  });

test("rejects malformed secret bindings, revisions, and material bounds",
  async () => {
    const context = getConfigdTestContext();
    const requests: PublishSecretRequest[] = [
      {
        ...createSecretRequest({
          secretId: "invalid_secret_binding"
        }),
        binding: undefined
      },
      createSecretRequest({
        secretId: "Invalid"
      }),
      {
        ...createSecretRequest({
          secretId: "invalid_secret_scope"
        }),
        binding: {
          placement: {
            placementId: "placement_invalid"
          },
          consumerId: "consumer_invalid",
          purpose: "api_credential"
        }
      },
      createSecretRequest({
        secretId: "invalid_secret_principal",
        scope: {
          kind: "user",
          tenantId: "secret_tenant",
          accountPrincipalId: "agent:private"
        }
      }),
      createSecretRequest({
        secretId: "invalid_secret_revision",
        expectedRevision: 0n
      }),
      createSecretRequest({
        secretId: "invalid_empty_secret",
        material: Buffer.alloc(0)
      })
    ];

    for (const request of requests) {
      await assert.rejects(
        publishSecret(context.client, request),
        matchGrpcStatus(status.INVALID_ARGUMENT));
    }
    await assert.rejects(
      publishSecret(
        context.client,
        createSecretRequest({
          secretId: "secret_too_large",
          material: Buffer.alloc(65_537, 0x7f)
        })),
      matchGrpcStatus(status.RESOURCE_EXHAUSTED));
  });

test("secret metadata requires exact identity and binding", async () => {
  const context = getConfigdTestContext();
  const request = createSecretRequest({
    secretId: "secret_resolution"
  });
  await publishSecret(context.client, request);

  await assert.rejects(
    getSecretMetadata(context.client, {
      secretId: "secret_absent",
      binding: request.binding
    }),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    getSecretMetadata(context.client, {
      secretId: request.secretId,
      binding: createConsumerBinding({
        consumerId: "another_consumer"
      })
    }),
    matchGrpcStatus(status.NOT_FOUND));
});

test("secret metadata rejects malformed selectors", async () => {
  const context = getConfigdTestContext();
  await assert.rejects(
    getSecretMetadata(context.client, {
      secretId: "Invalid",
      binding: createConsumerBinding()
    }),
    matchGrpcStatus(status.INVALID_ARGUMENT));
  await assert.rejects(
    getSecretMetadata(context.client, {
      secretId: "secret_valid",
      binding: undefined
    }),
    matchGrpcStatus(status.INVALID_ARGUMENT));
});

test("serializes concurrent secret publication by revision", async () => {
  const context = getConfigdTestContext();
  const first = createSecretRequest({
    secretId: "secret_concurrency"
  });
  await publishSecret(context.client, first);
  const outcomes = await Promise.allSettled([
    publishSecret(
      context.client,
      createSecretRequest({
        secretId: first.secretId,
        secretVersionId: "secret_concurrency_v2",
        expectedRevision: 1n
      })),
    publishSecret(
      context.client,
      createSecretRequest({
        secretId: first.secretId,
        secretVersionId: "secret_concurrency_v3",
        expectedRevision: 1n
      }))
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1);
  const rejected = outcomes.find(
    (outcome) => outcome.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.equal(
    (rejected.reason as { code?: unknown }).code,
    status.ABORTED);
});

test("refuses secret revision exhaustion and transport overflow",
  async () => {
    const context = getConfigdTestContext();
    const request = createSecretRequest({
      secretId: "secret_revision_limit"
    });
    await publishSecret(context.client, request);
    await context.database.connection("secrets")
      .where({ secret_id: request.secretId })
      .update({ revision: "9223372036854775807" });
    await assert.rejects(
      publishSecret(
        context.client,
        createSecretRequest({
          secretId: request.secretId,
          secretVersionId: "secret_revision_limit_v2",
          expectedRevision: 9_223_372_036_854_775_807n
        })),
      matchGrpcStatus(status.FAILED_PRECONDITION));
    await assert.rejects(
      publishSecret(
        context.client,
        createSecretRequest({
          secretId: "secret_transport_limit",
          material: Buffer.alloc(80_000, 0x7f)
        })),
      matchGrpcStatus(status.RESOURCE_EXHAUSTED));
  });
