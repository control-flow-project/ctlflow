import {
  AuditOutcome,
  type AuditEvent
} from "../../generated/v1/auditd.js";

const identifier = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const idempotencyKey = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const traceId = /^[0-9a-f]{32}$/u;
const spanId = /^[0-9a-f]{16}$/u;
const operations = new Set([
  "acknowledge_lifecycle_step",
  "create_tenant",
  "create_workspace",
  "delete_tenant",
  "delete_workspace",
  "resume_tenant",
  "resume_workspace",
  "retry_tenant",
  "retry_workspace",
  "suspend_tenant",
  "suspend_workspace",
  "update_tenant",
  "update_workspace"
]);

export function validateAuditEvent(event: AuditEvent): string | undefined {
  if (!identifier.test(event.sourceEventId)) {
    return "source event ID is invalid";
  }
  if (
    event.sourceSequence <= 0n
    || event.sourceSequence > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return "source sequence is invalid";
  }
  if (!idempotencyKey.test(event.idempotencyKey)) {
    return "idempotency key is invalid";
  }
  if (!operations.has(event.operation)) {
    return "operation is not registered";
  }
  if (
    event.occurredAt === undefined
    || Number.isNaN(event.occurredAt.getTime())
  ) {
    return "occurred time is invalid";
  }
  if (
    event.attribution?.kubernetesSubject === undefined
    || event.attribution.kubernetesSubject.length === 0
    || event.attribution.kubernetesSubject.length > 253
    || event.attribution.attachedActor !== undefined
    || event.attribution.runtimePrincipal !== undefined
    || (
      event.attribution.immediateCaller !== undefined
      && (
        event.attribution.immediateCaller.length === 0
        || event.attribution.immediateCaller.length > 253
      )
    )
  ) {
    return "attribution is invalid";
  }
  const tenantId = event.partition?.tenant?.tenantId;
  if (
    tenantId === undefined
    || !identifier.test(tenantId)
    || event.partition?.global !== undefined
  ) {
    return "partition is invalid";
  }
  const detail = event.tenancyMutation;
  if (
    detail === undefined
    || detail.resourceRevision <= 0n
    || detail.outcome !== AuditOutcome.AUDIT_OUTCOME_SUCCEEDED
    || (detail.tenant === undefined) === (detail.workspace === undefined)
  ) {
    return "tenancy detail is invalid";
  }
  if (
    detail.tenant !== undefined
    && (
      detail.tenant.tenantId !== tenantId
      || !identifier.test(detail.tenant.tenantId)
    )
  ) {
    return "Tenant target is invalid";
  }
  if (
    detail.workspace !== undefined
    && (
      detail.workspace.tenantId !== tenantId
      || !identifier.test(detail.workspace.tenantId)
      || !identifier.test(detail.workspace.workspaceId)
    )
  ) {
    return "Workspace target is invalid";
  }
  if (!traceId.test(event.traceId) || !spanId.test(event.spanId)) {
    return "trace correlation is invalid";
  }

  return undefined;
}
