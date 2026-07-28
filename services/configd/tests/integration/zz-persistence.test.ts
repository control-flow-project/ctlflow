import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import {
  getConfigdTestContext
} from "../suite/get-configd-test-context.js";
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
  provisionProjectionOwners
} from "../support/kubernetes/provision-projection-owners.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  applyProjection
} from "../support/projections/apply-projection.js";
import {
  createProjectionRequest
} from "../support/projections/create-projection-request.js";
import {
  createSecretRequest
} from "../support/secrets/create-secret-request.js";
import {
  getSecretMetadata
} from "../support/secrets/get-secret-metadata.js";
import {
  publishSecret
} from "../support/secrets/publish-secret.js";
import {
  waitForProbeStatus
} from "../support/wait-for-probe-status.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("readiness and RPCs fail closed when a mapped table is missing",
  async () => {
    const context = getConfigdTestContext();
    const request = createConfigurationRequest({
      configurationId: "schema_configuration"
    });
    await publishConfiguration(context.client, request);
    await context.database.connection.schema.renameTable(
      "configurations",
      "configurations_incompatible");
    try {
      await waitForProbeStatus(context.probePort, 503);
      await assert.rejects(
        resolveConfiguration(context.client, {
          configurationId: request.configurationId,
          configurationVersionId: request.configurationVersionId,
          binding: request.binding
        }),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.database.connection.schema.renameTable(
        "configurations_incompatible",
        "configurations");
    }
    await waitForProbeStatus(context.probePort, 204);
  });

test("readiness rejects an ahead or locked migration ledger", async () => {
  const context = getConfigdTestContext();
  await context.database.connection("knex_migrations").insert({
    name: "9999_unexpected.js",
    batch: 2,
    migration_time: new Date().toISOString()
  });
  try {
    await waitForProbeStatus(context.probePort, 503);
  } finally {
    await context.database.connection("knex_migrations")
      .where({ name: "9999_unexpected.js" })
      .delete();
  }
  await waitForProbeStatus(context.probePort, 204);

  await context.database.connection("knex_migrations_lock")
    .update({ is_locked: 1 });
  try {
    await waitForProbeStatus(context.probePort, 503);
  } finally {
    await context.database.connection("knex_migrations_lock")
      .update({ is_locked: 0 });
  }
  await waitForProbeStatus(context.probePort, 204);
});

test("readiness requires encryption keys for every retained secret",
  async () => {
    const context = getConfigdTestContext();
    const request = createSecretRequest({
      secretId: "key_coverage_secret"
    });
    await publishSecret(context.client, request);
    await context.database.connection("secret_versions")
      .where({ secret_version_id: request.secretVersionId })
      .update({ encryption_key_id: "missing_key" });
    try {
      await waitForProbeStatus(context.probePort, 503);
    } finally {
      await context.database.connection("secret_versions")
        .where({ secret_version_id: request.secretVersionId })
        .update({ encryption_key_id: "config_primary" });
    }
    await waitForProbeStatus(context.probePort, 204);
  });

test("authenticated encryption rejects altered retained secret state",
  async () => {
    const context = getConfigdTestContext();
    const binding = {
      placementId: "tamper_placement",
      consumerId: "tamper_workload",
      purpose: "api_credential"
    };
    await provisionProjectionOwners(
      context.kubernetes,
      binding.placementId,
      binding.consumerId);
    const request = createSecretRequest({
      secretId: "tamper_secret",
      ...binding
    });
    await publishSecret(context.client, request);
    const row = await context.database.connection("secret_versions")
      .where({ secret_version_id: request.secretVersionId })
      .first("ciphertext") as { readonly ciphertext: Buffer };
    const corrupted = Buffer.from(row.ciphertext);
    corrupted[0] = (corrupted[0] ?? 0) ^ 0xff;
    await context.database.connection("secret_versions")
      .where({ secret_version_id: request.secretVersionId })
      .update({ ciphertext: corrupted });
    await assert.rejects(
      applyProjection(
        context.workloadClient,
        createProjectionRequest({
          secret: {
            secretId: request.secretId,
            secretVersionId: request.secretVersionId
          }
        }, binding),
        workloadMetadata(context.execdWorkload.callerToken)),
      matchGrpcStatus(status.UNAVAILABLE));
  });

test("SQLite contains only migration metadata and Configd domain tables",
  async () => {
    const context = getConfigdTestContext();
    const objects = await context.database.connection("sqlite_master")
      .select("type", "name")
      .whereIn("type", ["table", "view", "trigger"])
      .orderBy(["type", "name"]) as Array<{
        readonly type: string;
        readonly name: string;
      }>;
    assert.deepEqual(
      objects.filter((object) => object.type === "table")
        .map((object) => object.name),
      [
        "configuration_versions",
        "configurations",
        "knex_migrations",
        "knex_migrations_lock",
        "projection_targets",
        "projections",
        "secret_versions",
        "secrets",
        "sqlite_sequence"
      ]);
    assert.deepEqual(
      objects.filter((object) => object.type === "view"),
      []);
    assert.deepEqual(
      objects.filter((object) => object.type === "trigger"),
      []);
  });

test("persists configuration, secret, and projection across restart",
  async () => {
    const context = getConfigdTestContext();
    const binding = {
      placementId: "restart_placement",
      consumerId: "restart_workload"
    };
    await provisionProjectionOwners(
      context.kubernetes,
      binding.placementId,
      binding.consumerId);
    const configuration = createConfigurationRequest({
      configurationId: "restart_configuration",
      ...binding
    });
    const secret = createSecretRequest({
      secretId: "restart_secret",
      purpose: "api_credential",
      ...binding
    });
    const publishedConfiguration = await publishConfiguration(
      context.client,
      configuration);
    const publishedSecret = await publishSecret(
      context.client,
      secret);
    const applyRequest = createProjectionRequest({
      configuration: {
        configurationId: configuration.configurationId,
        configurationVersionId:
          configuration.configurationVersionId
      }
    }, binding);
    const projection = await applyProjection(
      context.workloadClient,
      applyRequest,
      workloadMetadata(context.execdWorkload.callerToken));

    await context.service.restart(context.environment);
    assert.deepEqual(
      (await resolveConfiguration(context.client, {
        configurationId: configuration.configurationId,
        configurationVersionId:
          configuration.configurationVersionId,
        binding: configuration.binding
      })).configuration,
      publishedConfiguration.configuration);
    assert.deepEqual(
      (await getSecretMetadata(context.client, {
        secretId: secret.secretId,
        binding: secret.binding
      })).secret,
      publishedSecret.secret);
    assert.deepEqual(
      await applyProjection(
        context.workloadClient,
        applyRequest,
        workloadMetadata(context.execdWorkload.callerToken)),
      projection);
  });
