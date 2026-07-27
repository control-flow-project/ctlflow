import type {
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import {
  AuditEvent
} from "../../generated/v1/auditd.js";
import type {
  AuditdTestContext
} from "../create-auditd-test-context.js";
import {
  createAdmittedAuditBatches
} from "./create-admitted-audit-batches.js";

export type AuditDetailField =
  | "tenantMutation"
  | "workspaceMutation"
  | "identitySession"
  | "packageDeclaration"
  | "appMutation"
  | "configurationPublication"
  | "secretPublication"
  | "projectionMutation"
  | "placementMutation"
  | "workloadMutation"
  | "runMutation";

export interface AdmittedAuditEvent {
  readonly workload: TestWorkloadCredentials;
  readonly event: AuditEvent;
}

export function findAdmittedAuditEvent(
  context: AuditdTestContext,
  sourceName: string,
  detail: AuditDetailField
): AdmittedAuditEvent {
  const batch = createAdmittedAuditBatches(context)
    .find((value) => value.name === sourceName);
  const event = batch?.events.find(
    (value) => value[detail] !== undefined);
  if (batch === undefined || event === undefined) {
    throw new Error(
      `Missing ${sourceName} ${detail} audit event`);
  }

  return {
    workload: batch.workload,
    event: AuditEvent.decode(AuditEvent.encode(event).finish())
  };
}
