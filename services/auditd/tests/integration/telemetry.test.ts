import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import {
  status,
  type ClientUnaryCall,
  type Metadata,
  type ServiceError
} from "@grpc/grpc-js";
import type {
  AuditEvent,
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
  findSpansForTrace
} from "../support/telemetry/find-spans-for-trace.js";
import {
  hasOperationLog
} from "../support/telemetry/has-operation-log.js";
import {
  readAllExports
} from "../support/telemetry/read-all-exports.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("exports correlated and redacted traces, metrics, and logs", async () => {
  const context = getAuditdTestContext();
  const traceId = "1234567890abcdef1234567890abcdef";
  const parentSpanId = "1234567890abcdef";
  const tenantId = "telemetry_sensitive_tenant";
  const event = validEvent(tenantId);
  event.traceId = traceId;
  event.spanId = parentSpanId;
  event.attribution = {
    operatorCommonName: "telemetry-sensitive-operator"
  };
  const metadata = tracedMetadata(traceId, parentSpanId);

  const result = await record(event, metadata);
  assert.equal(
    result.acceptances[0]?.sourceEventId,
    event.sourceEventId);

  await waitForExport(
    context.collector.tracesPath,
    (value) => {
      const spans = findSpansForTrace(value, traceId);
      const server = spans.find(
        (span) => span.name === "auditd.RecordAuditBatch");
      const database = spans.find(
        (span) => span.name === "auditd.db.record_audit_batch");
      return typeof server?.spanId === "string"
        && database?.parentSpanId === server.spanId;
    });
  await waitForExport(
    context.collector.metricsPath,
    (value) =>
      value.includes("ctlflow.auditd.requests")
      && value.includes("ctlflow.auditd.duration")
      && value.includes("ctlflow.auditd.batch.size")
      && value.includes("ctlflow.auditd.events.accepted")
      && value.includes("tenant_mutation")
      && value.includes("tenantd"));
  await waitForExport(
    context.collector.logsPath,
    (value) => hasOperationLog(value, {
      operation: "RecordAuditBatch",
      outcome: "OK",
      traceId
    }));

  const exports = await readAllExports(context.collector);
  for (const sensitive of [
    event.sourceEventId,
    tenantId,
    "telemetry-sensitive-operator",
    context.workloads.tenantd.callerSubject,
    context.workloads.tenantd.callerToken
  ]) {
    assert.equal(exports.includes(sensitive), false, sensitive);
  }

  const malformed = workloadMetadata(
    context.workloads.tenantd.callerToken);
  malformed.set("traceparent", "not-a-traceparent");
  const malformedResult = await record(
    validEvent("telemetry_malformed_parent"),
    malformed);
  assert.equal(malformedResult.acceptances.length, 1);
});

test("exports cancellation and deadline outcomes before commit", async () => {
  const context = getAuditdTestContext();
  await context.database.connection.raw("BEGIN EXCLUSIVE");
  const blocker = startCall(
    validEvent("telemetry_blocker"),
    tracedMetadata(
      "11111111111111111111111111111111",
      "1111111111111111"));
  const cancelledTrace = "abcdef1234567890abcdef1234567890";
  const cancelled = validEvent("telemetry_cancelled");
  let call: ReturnType<typeof startCall> | undefined;
  let deadlineResult: Promise<RecordAuditBatchResponse> | undefined;
  try {
    await assertRemainsPending(blocker.result, 500);
    call = startCall(
      cancelled,
      tracedMetadata(cancelledTrace, "abcdef1234567890"));
    await assertRemainsPending(call.result, 250);
    call.cancel();
    await assert.rejects(
      call.result,
      matchGrpcStatus(status.CANCELLED));
    await waitForExport(
      context.collector.logsPath,
      (value) => hasOperationLog(value, {
        operation: "RecordAuditBatch",
        outcome: "CANCELLED",
        traceId: cancelledTrace
      }));

    const deadlineTrace = "fedcba0987654321fedcba0987654321";
    const deadline = validEvent("telemetry_deadline");
    deadlineResult = callUnary<RecordAuditBatchResponse>((done) =>
      context.client.recordAuditBatch(
        { events: [deadline] },
        tracedMetadata(deadlineTrace, "fedcba0987654321"),
        { deadline: Date.now() + 500 },
        done));
    await assert.rejects(
      deadlineResult,
      matchGrpcStatus(status.DEADLINE_EXCEEDED));
    await waitForExport(
      context.collector.logsPath,
      (value) => hasOperationLog(value, {
        operation: "RecordAuditBatch",
        outcome: "DEADLINE_EXCEEDED",
        traceId: deadlineTrace
      }));
  } finally {
    call?.cancel();
    await call?.result.catch(() => undefined);
    await deadlineResult?.catch(() => undefined);
    blocker.cancel();
    await blocker.result.catch(() => undefined);
    await context.database.connection.raw("ROLLBACK");
  }
});

test("telemetry outage is bounded and preserves acceptance", async () => {
  const context = getAuditdTestContext();
  await context.collector.suspend();
  try {
    const started = performance.now();
    const result = await record(
      validEvent("telemetry_outage"),
      workloadMetadata(context.workloads.tenantd.callerToken),
      Date.now() + 2_000);
    assert.equal(result.acceptances.length, 1);
    assert.ok(performance.now() - started < 1_800);
  } finally {
    await context.collector.resume();
  }
});

function validEvent(tenantId: string): AuditEvent {
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

function tracedMetadata(traceId: string, spanId: string): Metadata {
  const context = getAuditdTestContext();
  const metadata = workloadMetadata(
    context.workloads.tenantd.callerToken);
  metadata.set(
    "traceparent",
    `00-${traceId}-${spanId}-01`);
  return metadata;
}

async function record(
  event: AuditEvent,
  metadata: Metadata,
  deadline?: number
): Promise<RecordAuditBatchResponse> {
  const context = getAuditdTestContext();
  return await callUnary((done) =>
    context.client.recordAuditBatch(
      { events: [event] },
      metadata,
      deadline === undefined ? {} : { deadline },
      done));
}

function startCall(
  event: AuditEvent,
  metadata: Metadata
): {
  readonly result: Promise<RecordAuditBatchResponse>;
  readonly cancel: () => void;
} {
  const context = getAuditdTestContext();
  let call: ClientUnaryCall | undefined;
  const result = new Promise<RecordAuditBatchResponse>(
    (resolve, reject) => {
      call = context.client.recordAuditBatch(
        { events: [event] },
        metadata,
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

async function assertRemainsPending(
  result: Promise<RecordAuditBatchResponse>,
  durationMilliseconds: number
): Promise<void> {
  const pending = Symbol("pending");
  assert.equal(
    await Promise.race([
      result.then(
        () => "resolved",
        () => "rejected"),
      delay(durationMilliseconds, pending)
    ]),
    pending);
}
