import type {
  AuditEvent
} from "../../generated/v1/auditd.js";
import type {
  AuditEventEvidence
} from "./audit-event-evidence.js";

export function createAuditEventEvidence(
  event: AuditEvent,
  partitionCursor: number
): AuditEventEvidence {
  const attribution = event.attribution!;
  const detail = event.tenancyMutation!;
  const tenantId = event.partition!.tenant!.tenantId;
  const target = detail.tenant === undefined
    ? {
        kind: "workspace" as const,
        tenantId: detail.workspace!.tenantId,
        workspaceId: detail.workspace!.workspaceId
      }
    : {
        kind: "tenant" as const,
        tenantId: detail.tenant.tenantId
      };

  return {
    sourceEventId: event.sourceEventId,
    sourceSequence: event.sourceSequence.toString(),
    idempotencyKey: event.idempotencyKey,
    operation: event.operation,
    occurredAt: event.occurredAt!.toISOString(),
    operatorSubject: attribution.kubernetesSubject!,
    ...(attribution.immediateCaller === undefined
      ? {}
      : { immediateCaller: attribution.immediateCaller }),
    tenantId,
    target,
    resourceRevision: detail.resourceRevision.toString(),
    outcome: "succeeded",
    traceId: event.traceId,
    spanId: event.spanId,
    partitionCursor: String(partitionCursor)
  };
}
