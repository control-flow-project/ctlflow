import assert from "node:assert/strict";
import { test } from "node:test";
import {
  status,
  type ClientUnaryCall,
  type ServiceError
} from "@grpc/grpc-js";
import type {
  RecordAuditBatchResponse
} from "../generated/v1/auditd.js";
import {
  getAuditdTestContext
} from "../suite/get-auditd-test-context.js";
import {
  createAuditEvent
} from "../support/audit-events/create-audit-event.js";
import {
  tenantPartition
} from "../support/audit-events/tenant-partition.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("cancels an in-flight batch before durable commit", async () => {
  const context = getAuditdTestContext();
  const tenantId = "cancellation";
  const event = validEvent(tenantId);
  await context.database.connection.raw("BEGIN EXCLUSIVE");
  const call = startCall(event);
  try {
    await waitUntilRequestAdmission();
    call.cancel();
    await assert.rejects(
      call.result,
      matchGrpcStatus(status.CANCELLED));
  } finally {
    call.cancel();
    await call.result.catch(() => undefined);
    await context.database.connection.raw("ROLLBACK");
  }
  await assertNotPersisted(event.sourceEventId, tenantId);
});

test("expires an in-flight batch before durable commit", async () => {
  const context = getAuditdTestContext();
  const tenantId = "deadline";
  const event = validEvent(tenantId);
  await context.database.connection.raw("BEGIN EXCLUSIVE");
  const result = callUnary<RecordAuditBatchResponse>((done) =>
    context.client.recordAuditBatch(
      { events: [event] },
      workloadMetadata(context.workloads.tenantd.callerToken),
      { deadline: Date.now() + 500 },
      done));
  try {
    await assert.rejects(
      result,
      matchGrpcStatus(status.DEADLINE_EXCEEDED));
  } finally {
    await result.catch(() => undefined);
    await context.database.connection.raw("ROLLBACK");
  }
  await assertNotPersisted(event.sourceEventId, tenantId);
});

function startCall(event: ReturnType<typeof validEvent>): {
  readonly result: Promise<RecordAuditBatchResponse>;
  readonly cancel: () => void;
} {
  const context = getAuditdTestContext();
  let call: ClientUnaryCall | undefined;
  const result = new Promise<RecordAuditBatchResponse>(
    (resolve, reject) => {
      call = context.client.recordAuditBatch(
        { events: [event] },
        workloadMetadata(context.workloads.tenantd.callerToken),
        (
          error: ServiceError | null,
          response: RecordAuditBatchResponse
        ) => {
          if (error === null) {
            resolve(response);
          } else {
            reject(error);
          }
        });
      call.on("error", () => undefined);
    });
  return {
    result,
    cancel: () => call?.cancel()
  };
}

async function waitUntilRequestAdmission(): Promise<void> {
  const context = getAuditdTestContext();
  await assert.rejects(
    callUnary<RecordAuditBatchResponse>((done) =>
      context.client.recordAuditBatch(
        { events: [] },
        workloadMetadata(context.workloads.tenantd.callerToken),
        done)),
    matchGrpcStatus(status.INVALID_ARGUMENT));
}

function validEvent(tenantId: string) {
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

async function assertNotPersisted(
  sourceEventId: string,
  tenantId: string
): Promise<void> {
  const context = getAuditdTestContext();
  const event = await context.database.connection("audit_events")
    .where({ source_event_id: sourceEventId })
    .first();
  const head = await context.database.connection(
    "audit_partition_heads")
    .where({ partition_key: `tenant:${tenantId}` })
    .first();
  assert.equal(event, undefined);
  assert.equal(head, undefined);
}
