import assert from "node:assert/strict";
import {
  createHash
} from "node:crypto";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import type {
  PublishConfigurationRequest
} from "../generated/v1/configd.js";
import {
  getConfigdTestContext
} from "../suite/get-configd-test-context.js";
import {
  createConsumerBinding
} from "../support/bindings/create-consumer-binding.js";
import {
  createConfigurationRequest
} from "../support/configurations/create-configuration-request.js";
import {
  publishConfiguration
} from "../support/configurations/publish-configuration.js";
import {
  resolveConfiguration
} from "../support/configurations/resolve-configuration.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";

test("publishes and resolves exact configuration bytes in every scope",
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
          tenantId: "config_tenant"
        }
      },
      {
        suffix: "workspace",
        scope: {
          kind: "workspace" as const,
          tenantId: "config_tenant",
          workspaceId: "config_workspace"
        }
      },
      {
        suffix: "user",
        scope: {
          kind: "user" as const,
          tenantId: "config_tenant",
          accountPrincipalId: "user:alice"
        }
      }
    ];

    for (const current of cases) {
      const content = Buffer.from(
        `{"scope":"${current.suffix}","ordered":[2,1]}`,
        "utf8");
      const request = createConfigurationRequest({
        configurationId: `configuration_${current.suffix}`,
        placementId: `placement_${current.suffix}`,
        consumerId: `consumer_${current.suffix}`,
        purpose: "runtime_config",
        scope: current.scope,
        content
      });
      const published = await publishConfiguration(
        context.client,
        request);
      assert.equal(
        published.configuration?.configurationId,
        request.configurationId);
      assert.equal(published.configuration?.revision, 1n);
      assert.equal(
        published.configuration?.currentConfigurationVersionId,
        request.configurationVersionId);
      assert.deepEqual(
        published.configuration?.binding,
        request.binding);
      assert.equal(
        published.version?.contentLength,
        content.length);
      assert.deepEqual(
        published.version?.contentSha256,
        createHash("sha256").update(content).digest());
      assert.ok(published.configuration?.createdAt instanceof Date);

      const resolved = await resolveConfiguration(context.client, {
        configurationId: request.configurationId,
        configurationVersionId: request.configurationVersionId,
        binding: request.binding
      });
      assert.deepEqual(resolved.contentJson, content);
      assert.deepEqual(
        resolved.configuration,
        published.configuration);
      assert.deepEqual(resolved.version, published.version);
    }
  });

test("appends, replays, and resolves retained configuration versions",
  async () => {
    const context = getConfigdTestContext();
    const first = createConfigurationRequest({
      configurationId: "configuration_versions",
      content: Buffer.from('{"generation":1}', "utf8")
    });
    const created = await publishConfiguration(context.client, first);
    const second = createConfigurationRequest({
      configurationId: first.configurationId,
      configurationVersionId: "configuration_versions_v2",
      expectedRevision: 1n,
      content: Buffer.from('{"generation":2}', "utf8")
    });
    const changed = await publishConfiguration(context.client, second);
    assert.equal(created.configuration?.revision, 1n);
    assert.equal(changed.configuration?.revision, 2n);
    assert.equal(
      changed.configuration?.currentConfigurationVersionId,
      second.configurationVersionId);

    assert.deepEqual(
      await publishConfiguration(context.client, second),
      changed);
    const retained = await resolveConfiguration(context.client, {
      configurationId: first.configurationId,
      configurationVersionId: first.configurationVersionId,
      binding: first.binding
    });
    assert.deepEqual(retained.contentJson, first.contentJson);
    assert.equal(retained.configuration?.revision, 2n);
    assert.equal(
      retained.configuration?.currentConfigurationVersionId,
      second.configurationVersionId);
  });

test("enforces configuration create, revision, binding, and replay rules",
  async () => {
    const context = getConfigdTestContext();
    const first = createConfigurationRequest({
      configurationId: "configuration_conflicts"
    });
    await publishConfiguration(context.client, first);

    await assert.rejects(
      publishConfiguration(context.client, {
        ...first,
        configurationVersionId: "configuration_conflicts_other"
      }),
      matchGrpcStatus(status.ALREADY_EXISTS));
    await assert.rejects(
      publishConfiguration(
        context.client,
        createConfigurationRequest({
          configurationId: first.configurationId,
          configurationVersionId: first.configurationVersionId,
          content: Buffer.from('{"different":true}', "utf8")
        })),
      matchGrpcStatus(status.ALREADY_EXISTS));
    await assert.rejects(
      publishConfiguration(
        context.client,
        createConfigurationRequest({
          configurationId: first.configurationId,
          configurationVersionId: "configuration_conflicts_v2",
          expectedRevision: 9n
        })),
      matchGrpcStatus(status.ABORTED));
    await assert.rejects(
      publishConfiguration(
        context.client,
        createConfigurationRequest({
          configurationId: "configuration_absent_update",
          expectedRevision: 1n
        })),
      matchGrpcStatus(status.NOT_FOUND));
    await assert.rejects(
      publishConfiguration(
        context.client,
        createConfigurationRequest({
          configurationId: first.configurationId,
          configurationVersionId: "configuration_wrong_binding_v2",
          expectedRevision: 1n,
          consumerId: "another_consumer"
        })),
      matchGrpcStatus(status.NOT_FOUND));
  });

test("rejects malformed configuration bindings, revisions, and JSON",
  async () => {
    const context = getConfigdTestContext();
    const requests: PublishConfigurationRequest[] = [
      {
        ...createConfigurationRequest({
          configurationId: "invalid_missing_binding"
        }),
        binding: undefined
      },
      {
        ...createConfigurationRequest({
          configurationId: "Invalid"
        })
      },
      {
        ...createConfigurationRequest({
          configurationId: "invalid_scope"
        }),
        binding: {
          placement: {
            placementId: "placement_invalid"
          },
          consumerId: "consumer_invalid",
          purpose: "runtime_config"
        }
      },
      createConfigurationRequest({
        configurationId: "invalid_purpose",
        purpose: "RuntimeConfig"
      }),
      createConfigurationRequest({
        configurationId: "invalid_revision",
        expectedRevision: 0n
      }),
      createConfigurationRequest({
        configurationId: "invalid_empty_json",
        content: Buffer.alloc(0)
      }),
      createConfigurationRequest({
        configurationId: "invalid_bom_json",
        content: Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])
      }),
      createConfigurationRequest({
        configurationId: "invalid_array_json",
        content: Buffer.from("[]", "utf8")
      }),
      createConfigurationRequest({
        configurationId: "invalid_duplicate_json",
        content: Buffer.from('{"item":1,"item":2}', "utf8")
      }),
      createConfigurationRequest({
        configurationId: "invalid_utf8_json",
        content: Buffer.from([0xff])
      }),
      createConfigurationRequest({
        configurationId: "invalid_deep_json",
        content: Buffer.from(
          `{"value":${"[".repeat(33)}0${"]".repeat(33)}}`,
          "utf8")
      })
    ];

    for (const request of requests) {
      await assert.rejects(
        publishConfiguration(context.client, request),
        matchGrpcStatus(status.INVALID_ARGUMENT));
    }
    await assert.rejects(
      publishConfiguration(
        context.client,
        createConfigurationRequest({
          configurationId: "configuration_too_large",
          content: Buffer.alloc(65_537, 0x20)
        })),
      matchGrpcStatus(status.RESOURCE_EXHAUSTED));
  });

test("configuration resolution requires exact identity, version, and binding",
  async () => {
    const context = getConfigdTestContext();
    const request = createConfigurationRequest({
      configurationId: "configuration_resolution"
    });
    await publishConfiguration(context.client, request);

    for (const query of [
      {
        configurationId: "configuration_absent",
        configurationVersionId: request.configurationVersionId,
        binding: request.binding
      },
      {
        configurationId: request.configurationId,
        configurationVersionId: "configuration_absent_version",
        binding: request.binding
      },
      {
        configurationId: request.configurationId,
        configurationVersionId: request.configurationVersionId,
        binding: createConsumerBinding({
          consumerId: "another_consumer"
        })
      }
    ]) {
      await assert.rejects(
        resolveConfiguration(context.client, query),
        matchGrpcStatus(status.NOT_FOUND));
    }
  });

test("configuration resolution rejects malformed selectors", async () => {
  const context = getConfigdTestContext();
  await assert.rejects(
    resolveConfiguration(context.client, {
      configurationId: "Invalid",
      configurationVersionId: "version_one",
      binding: createConsumerBinding()
    }),
    matchGrpcStatus(status.INVALID_ARGUMENT));
  await assert.rejects(
    resolveConfiguration(context.client, {
      configurationId: "configuration_valid",
      configurationVersionId: "Invalid",
      binding: createConsumerBinding()
    }),
    matchGrpcStatus(status.INVALID_ARGUMENT));
});

test("serializes concurrent configuration publication by revision",
  async () => {
    const context = getConfigdTestContext();
    const first = createConfigurationRequest({
      configurationId: "configuration_concurrency"
    });
    await publishConfiguration(context.client, first);
    const outcomes = await Promise.allSettled([
      publishConfiguration(
        context.client,
        createConfigurationRequest({
          configurationId: first.configurationId,
          configurationVersionId: "configuration_concurrency_v2",
          expectedRevision: 1n
        })),
      publishConfiguration(
        context.client,
        createConfigurationRequest({
          configurationId: first.configurationId,
          configurationVersionId: "configuration_concurrency_v3",
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

test("refuses configuration revision exhaustion and transport overflow",
  async () => {
    const context = getConfigdTestContext();
    const request = createConfigurationRequest({
      configurationId: "configuration_revision_limit"
    });
    await publishConfiguration(context.client, request);
    await context.database.connection("configurations")
      .where({ configuration_id: request.configurationId })
      .update({ revision: "9223372036854775807" });
    await assert.rejects(
      publishConfiguration(
        context.client,
        createConfigurationRequest({
          configurationId: request.configurationId,
          configurationVersionId: "configuration_revision_limit_v2",
          expectedRevision: 9_223_372_036_854_775_807n
        })),
      matchGrpcStatus(status.FAILED_PRECONDITION));
    await assert.rejects(
      publishConfiguration(
        context.client,
        createConfigurationRequest({
          configurationId: "configuration_transport_limit",
          content: Buffer.alloc(80_000, 0x20)
        })),
      matchGrpcStatus(status.RESOURCE_EXHAUSTED));
  });
