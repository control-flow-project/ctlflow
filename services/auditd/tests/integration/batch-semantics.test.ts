import assert from "node:assert/strict";
import { test } from "node:test";
import {
  status
} from "@grpc/grpc-js";
import type {
  AuditEvent
} from "../generated/v1/auditd.js";
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

test("enforces the one-to-100 event batch bounds", async () => {
  const context = getAuditdTestContext();
  await assert.rejects(
    recordAuditBatch(
      context,
      context.workloads.tenantd,
      []),
    matchGrpcStatus(status.INVALID_ARGUMENT));

  const admitted = Array.from(
    { length: 100 },
    () => tenantEvent("batch_maximum"));
  const result = await recordAuditBatch(
    context,
    context.workloads.tenantd,
    admitted);
  assert.equal(result.acceptances.length, 100);

  await assert.rejects(
    recordAuditBatch(
      context,
      context.workloads.tenantd,
      Array.from(
        { length: 101 },
        () => tenantEvent("batch_too_large"))),
    matchGrpcStatus(status.RESOURCE_EXHAUSTED));
});

test("rejects duplicate request event IDs without writing", async () => {
  const context = getAuditdTestContext();
  const event = tenantEvent("batch_duplicate");
  const before = await eventCount();
  await assert.rejects(
    recordAuditBatch(
      context,
      context.workloads.tenantd,
      [event, structuredClone(event)]),
    matchGrpcStatus(status.INVALID_ARGUMENT));
  assert.equal(await eventCount(), before);
});

test("rolls back a mixed valid and invalid batch", async () => {
  const context = getAuditdTestContext();
  const partition = "batch_validation_rollback";
  const valid = tenantEvent(partition);
  const invalid = tenantEvent(partition);
  invalid.tenantMutation!.resourceRevision = 0n;
  const before = await eventCount();

  await assert.rejects(
    recordAuditBatch(
      context,
      context.workloads.tenantd,
      [valid, invalid]),
    matchGrpcStatus(status.INVALID_ARGUMENT));
  assert.equal(await eventCount(), before);
  assert.equal(await partitionCursor(`tenant:${partition}`), undefined);
});

test("replays identical content without advancing its partition", async () => {
  const context = getAuditdTestContext();
  const partition = "batch_replay";
  const event = tenantEvent(partition);
  const first = await recordAuditBatch(
    context,
    context.workloads.tenantd,
    [event]);
  const rows = await eventCount();
  const head = await partitionCursor(`tenant:${partition}`);

  const replay = await recordAuditBatch(
    context,
    context.workloads.tenantd,
    [structuredClone(event)]);
  assert.deepEqual(replay, first);
  assert.equal(await eventCount(), rows);
  assert.equal(await partitionCursor(`tenant:${partition}`), head);
});

test("rejects conflicting replay and rolls back novel events", async () => {
  const context = getAuditdTestContext();
  const stored = tenantEvent("batch_conflict");
  await recordAuditBatch(
    context,
    context.workloads.tenantd,
    [stored]);
  const conflict = structuredClone(stored);
  conflict.traceId = "f".repeat(32);
  const novel = tenantEvent("batch_conflict_novel");
  const before = await eventCount();

  await assert.rejects(
    recordAuditBatch(
      context,
      context.workloads.tenantd,
      [novel, conflict]),
    matchGrpcStatus(status.ALREADY_EXISTS));
  assert.equal(await eventCount(), before);
  assert.equal(
    await storedEventCount(novel.sourceEventId),
    0);
  assert.equal(
    await partitionCursor("tenant:batch_conflict_novel"),
    undefined);
});

test("allocates partition cursors in request order", async () => {
  const context = getAuditdTestContext();
  const admitted = findAdmittedAuditEvent(
    context,
    "execd",
    "placementMutation");
  const partitionA = "batch_partition_a";
  const partitionB = "batch_partition_b";
  const globalBefore = await partitionCursor("global") ?? 0n;
  const events = [
    placementEvent(admitted.event, {
      tenant: { tenantId: partitionA }
    }, tenantPartition(partitionA), "a"),
    placementEvent(admitted.event, {
      global: {}
    }, { global: {} }, "b"),
    placementEvent(admitted.event, {
      tenant: { tenantId: partitionA }
    }, tenantPartition(partitionA), "c"),
    placementEvent(admitted.event, {
      tenant: { tenantId: partitionB }
    }, tenantPartition(partitionB), "d"),
    placementEvent(admitted.event, {
      global: {}
    }, { global: {} }, "e")
  ];

  const result = await recordAuditBatch(
    context,
    admitted.workload,
    events);
  assert.deepEqual(
    result.acceptances.map((value) => value.sourceEventId),
    events.map((value) => value.sourceEventId));
  assert.deepEqual(
    result.acceptances.map((value) => value.partitionCursor),
    [1n, globalBefore + 1n, 2n, 1n, globalBefore + 2n]);
});

test("serializes concurrent cursor allocation without gaps", async () => {
  const context = getAuditdTestContext();
  const partition = "batch_concurrent";
  const events = Array.from(
    { length: 20 },
    () => tenantEvent(partition));
  const responses = await Promise.all(events.map(
    async (event) => await recordAuditBatch(
      context,
      context.workloads.tenantd,
      [event])));
  const cursors = responses
    .map((response) => response.acceptances[0]!.partitionCursor)
    .sort((left, right) => left < right ? -1 : 1);
  assert.deepEqual(
    cursors,
    Array.from({ length: 20 }, (_, index) => BigInt(index + 1)));
});

test("fails atomically when a partition cursor is exhausted", async () => {
  const context = getAuditdTestContext();
  const partition = "batch_exhausted";
  await recordAuditBatch(
    context,
    context.workloads.tenantd,
    [tenantEvent(partition)]);
  await context.database.connection("audit_partition_heads")
    .where({ partition_key: `tenant:${partition}` })
    .update({ current_cursor: "9223372036854775807" });
  const event = tenantEvent(partition);
  const before = await eventCount();
  try {
    await assert.rejects(
      recordAuditBatch(
        context,
        context.workloads.tenantd,
        [event]),
      matchGrpcStatus(status.RESOURCE_EXHAUSTED));
    assert.equal(await eventCount(), before);
  } finally {
    await context.database.connection("audit_partition_heads")
      .where({ partition_key: `tenant:${partition}` })
      .update({ current_cursor: 1 });
  }
});

test("rolls back the event and cursor on persistence failure", async () => {
  const context = getAuditdTestContext();
  const partition = "batch_persistence_rollback";
  const event = tenantEvent(partition);
  const before = await eventCount();
  await context.database.connection.schema.renameTable(
    "audit_tenant_mutations",
    "audit_tenant_mutations_unavailable");
  try {
    await assert.rejects(
      recordAuditBatch(
        context,
        context.workloads.tenantd,
        [event]),
      matchGrpcStatus(status.UNAVAILABLE));
    assert.equal(await eventCount(), before);
    assert.equal(
      await partitionCursor(`tenant:${partition}`),
      undefined);
  } finally {
    await context.database.connection.schema.renameTable(
      "audit_tenant_mutations_unavailable",
      "audit_tenant_mutations");
  }
});

function tenantEvent(tenantId: string): AuditEvent {
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

function placementEvent(
  baseline: AuditEvent,
  target: NonNullable<
    NonNullable<AuditEvent["placementMutation"]>["target"]
  >,
  partition: NonNullable<AuditEvent["partition"]>,
  suffix: string
): AuditEvent {
  const event = structuredClone(baseline);
  event.sourceEventId = `evt_${suffix.repeat(32)}`;
  event.traceId = suffix.repeat(32);
  event.spanId = suffix.repeat(16);
  event.partition = partition;
  event.placementMutation!.placementId = `batch_placement_${suffix}`;
  event.placementMutation!.target = target;
  return event;
}

async function eventCount(): Promise<number> {
  const row = await getAuditdTestContext()
    .database.connection("audit_events")
    .count({ count: "*" })
    .first();
  return Number(row?.count ?? 0);
}

async function storedEventCount(sourceEventId: string): Promise<number> {
  const row = await getAuditdTestContext()
    .database.connection("audit_events")
    .where({ source_event_id: sourceEventId })
    .count({ count: "*" })
    .first();
  return Number(row?.count ?? 0);
}

async function partitionCursor(
  partitionKey: string
): Promise<bigint | undefined> {
  const row = await getAuditdTestContext()
    .database.connection("audit_partition_heads")
    .select("current_cursor")
    .where({ partition_key: partitionKey })
    .first();
  return row === undefined
    ? undefined
    : BigInt(row.current_cursor as string | number);
}
