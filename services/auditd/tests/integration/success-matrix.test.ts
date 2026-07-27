import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getAuditdTestContext
} from "../suite/get-auditd-test-context.js";
import {
  createAdmittedAuditBatches
} from "../support/audit-events/create-admitted-audit-batches.js";
import {
  recordAuditBatch
} from "../support/record-audit-batch.js";

const expectedDetailRows = new Map([
  ["audit_tenant_mutations", 3],
  ["audit_workspace_mutations", 3],
  ["audit_identity_sessions", 2],
  ["audit_package_declarations", 1],
  ["audit_app_mutations", 4],
  ["audit_configuration_publications", 4],
  ["audit_secret_publications", 4],
  ["audit_projection_mutations", 2],
  ["audit_placement_mutations", 4],
  ["audit_workload_mutations", 4],
  ["audit_run_mutations", 4]
]);

test(
  "accepts every admitted source, detail, attribution, action, state, and target combination",
  async () => {
    const context = getAuditdTestContext();
    const before = await readDetailCounts();

    for (const batch of createAdmittedAuditBatches(context)) {
      const response = await recordAuditBatch(
        context,
        batch.workload,
        batch.events);
      assert.deepEqual(
        response.acceptances.map((value) => value.sourceEventId),
        batch.events.map((value) => value.sourceEventId),
        batch.name);
      assert.ok(
        response.acceptances.every(
          (value) => value.partitionCursor > 0n),
        batch.name);

      const stored = await context.database.connection("audit_events")
        .select(
          "source_event_id",
          "source_principal",
          "source_subject",
          "accepted_at_seconds",
          "partition_cursor")
        .whereIn(
          "source_event_id",
          batch.events.map((value) => value.sourceEventId))
        .orderBy("source_event_id");
      assert.equal(stored.length, batch.events.length, batch.name);
      assert.ok(
        stored.every((value) =>
          value.source_principal === batch.sourcePrincipal
          && value.source_subject === batch.sourceSubject
          && Number(value.accepted_at_seconds) > 0
          && Number(value.partition_cursor) > 0),
        batch.name);
    }

    const after = await readDetailCounts();
    for (const [table, expected] of expectedDetailRows) {
      assert.equal(
        after.get(table)! - before.get(table)!,
        expected,
        table);
    }
  });

async function readDetailCounts(): Promise<Map<string, number>> {
  const context = getAuditdTestContext();
  const counts = new Map<string, number>();
  for (const table of expectedDetailRows.keys()) {
    const row = await context.database.connection(table)
      .count({ count: "*" })
      .first();
    counts.set(table, Number(row?.count ?? 0));
  }
  return counts;
}
