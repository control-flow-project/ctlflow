import type {
  CallOptions
} from "@grpc/grpc-js";
import type {
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import type {
  AuditEvent,
  RecordAuditBatchResponse
} from "../generated/v1/auditd.js";
import type {
  AuditdTestContext
} from "./create-auditd-test-context.js";
import {
  callUnary
} from "./call-unary.js";
import {
  workloadMetadata
} from "./workload-metadata.js";

export async function recordAuditBatch(
  context: AuditdTestContext,
  workload: TestWorkloadCredentials,
  events: readonly AuditEvent[],
  options?: CallOptions
): Promise<RecordAuditBatchResponse> {
  return await callUnary((callback) =>
    context.client.recordAuditBatch(
      { events: [...events] },
      workloadMetadata(workload.callerToken),
      options ?? {},
      callback));
}
