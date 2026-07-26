interface AuditEventEvidenceBase {
  readonly sourceEventId: string;
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly occurredAt: string;
  readonly kubernetesSubject?: string;
  readonly actorPrincipalId?: string;
  readonly attachedAccountPrincipalId?: string;
  readonly immediateCaller?: string;
  readonly tenantId: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly receivedTraceparent?: string;
}

export interface TenancyAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly targetKind: "tenant" | "workspace";
  readonly targetId: string;
  readonly outcome: number;
  readonly resultingState: number;
  readonly resourceRevision: bigint;
}

export interface IdentitySessionAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly targetKind: "session";
  readonly sessionId: string;
  readonly accountPrincipalId: string;
  readonly sessionRevision: bigint;
  readonly action: "created" | "revoked";
}

export type AuditEventEvidence =
  | TenancyAuditEventEvidence
  | IdentitySessionAuditEventEvidence;
