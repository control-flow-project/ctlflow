import assert from "node:assert/strict";
import {
  status
} from "@grpc/grpc-js";
import {
  AuditEvent,
  type AuditEvent as AuditEventValue
} from "../../generated/v1/auditd.js";
import type {
  AuditdTestContext
} from "../create-auditd-test-context.js";
import {
  matchGrpcStatus
} from "../match-grpc-status.js";
import {
  recordAuditBatch
} from "../record-audit-batch.js";
import {
  findAdmittedAuditEvent,
  type AdmittedAuditEvent,
  type AuditDetailField
} from "./find-admitted-audit-event.js";

export type MutateAuditEvent = (event: AuditEventValue) => void;

export function admittedAuditDetail(
  context: AuditdTestContext,
  sourceName: string,
  detail: AuditDetailField
): AdmittedAuditEvent {
  return findAdmittedAuditEvent(context, sourceName, detail);
}

export async function rejectAuditDetailCases(
  context: AuditdTestContext,
  admittedEvent: AdmittedAuditEvent,
  cases: readonly (readonly [string, MutateAuditEvent])[]
): Promise<void> {
  for (const [name, mutate] of cases) {
    const event = AuditEvent.decode(
      AuditEvent.encode(admittedEvent.event).finish());
    mutate(event);
    await assert.rejects(
      recordAuditBatch(
        context,
        admittedEvent.workload,
        [event]),
      matchGrpcStatus(status.INVALID_ARGUMENT),
      name);
  }
}
