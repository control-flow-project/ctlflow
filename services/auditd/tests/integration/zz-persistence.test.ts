import assert from "node:assert/strict";
import {
  copyFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  getAuditdTestContext
} from "../suite/get-auditd-test-context.js";
import {
  createAuditEvent
} from "../support/audit-events/create-audit-event.js";
import {
  findAdmittedAuditEvent
} from "../support/audit-events/find-admitted-audit-event.js";
import {
  tenantPartition
} from "../support/audit-events/tenant-partition.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  recordAuditBatch
} from "../support/record-audit-batch.js";
import {
  waitForProbeStatus
} from "../support/wait-for-probe-status.js";

test("readiness and the owning operation fail on missing mapped schema",
  async () => {
    const context = getAuditdTestContext();
    const admitted = findAdmittedAuditEvent(
      context,
      "configd",
      "configurationPublication");
    await context.database.connection.schema.renameTable(
      "audit_configuration_publications",
      "audit_configuration_publications_incompatible");
    try {
      await waitForProbeStatus(context.probePort, 503);
      await assert.rejects(
        recordAuditBatch(
          context,
          admitted.workload,
          [admitted.event]),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.database.connection.schema.renameTable(
        "audit_configuration_publications_incompatible",
        "audit_configuration_publications");
    }
    await waitForProbeStatus(context.probePort, 204);
  });

test("readiness rejects an ahead or locked migration ledger", async () => {
  const context = getAuditdTestContext();
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

test("startup rejects malformed and duplicate source admission", async () => {
  const context = getAuditdTestContext();
  const tenantdSubject =
    context.environment.CTLFLOW_SOURCE_TENANTD_SUBJECT!;
  try {
    await assert.rejects(context.service.restart({
      CTLFLOW_SOURCE_EXECD_SUBJECT: tenantdSubject
    }));
    await assert.rejects(context.service.restart({
      ...context.environment,
      CTLFLOW_SOURCE_EXECD_SUBJECT: "not-a-workload"
    }));
  } finally {
    await context.service.restart(context.environment);
  }
  await waitForProbeStatus(context.probePort, 204);
});

test("startup and readiness reject unavailable local trust", async () => {
  const context = getAuditdTestContext();
  const trustPath = path.join(
    context.database.directory,
    "workload-jwks.json");
  try {
    await assert.rejects(context.service.restart({
      CTLFLOW_WORKLOAD_JWKS_PATH:
        "/var/run/ctlflow/trust/missing.json"
    }));
    await writeFile(trustPath, "{}", "utf8");
    await assert.rejects(
      context.service.restart(context.environment));
  } finally {
    await copyFile(
      context.workloads.tenantd.jwksPath,
      trustPath);
    await context.service.restart(context.environment);
  }
  await waitForProbeStatus(context.probePort, 204);
});

test("SQLite contains only migration metadata and audit domain tables",
  async () => {
    const context = getAuditdTestContext();
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
        "audit_app_mutations",
        "audit_configuration_publications",
        "audit_events",
        "audit_identity_sessions",
        "audit_package_declarations",
        "audit_partition_heads",
        "audit_placement_mutations",
        "audit_projection_mutations",
        "audit_run_mutations",
        "audit_secret_publications",
        "audit_tenant_mutations",
        "audit_workload_mutations",
        "audit_workspace_mutations",
        "knex_migrations",
        "knex_migrations_lock",
        "sqlite_sequence"
      ]);
    assert.deepEqual(
      objects.filter((object) => object.type === "view"),
      []);
    assert.deepEqual(
      objects.filter((object) => object.type === "trigger"),
      []);
  });

test("preserves evidence, replay, and cursor state across restart",
  async () => {
    const context = getAuditdTestContext();
    const tenantId = "restart_durability";
    const firstEvent = tenantEvent(tenantId);
    const first = await recordAuditBatch(
      context,
      context.workloads.tenantd,
      [firstEvent]);

    await context.service.restart();
    const replay = await recordAuditBatch(
      context,
      context.workloads.tenantd,
      [structuredClone(firstEvent)]);
    assert.deepEqual(replay, first);

    const second = await recordAuditBatch(
      context,
      context.workloads.tenantd,
      [tenantEvent(tenantId)]);
    assert.equal(
      second.acceptances[0]!.partitionCursor,
      first.acceptances[0]!.partitionCursor + 1n);
  });

function tenantEvent(tenantId: string) {
  return createAuditEvent({
    tenantMutation: {
      action: 1,
      resourceRevision: 1n,
      resultingState: 1
    }
  }, {
    partition: tenantPartition(tenantId)
  });
}
