export interface AuditEventEvidence {
  readonly sourceEventId: string;
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly occurredAt: string;
  readonly kubernetesSubject?: string;
  readonly actorPrincipalId?: string;
  readonly attachedAccountPrincipalId?: string;
  readonly immediateCaller?: string;
  readonly tenantId: string;
  readonly targetKind: "tenant" | "workspace";
  readonly targetId: string;
  readonly outcome: number;
  readonly resultingState: number;
  readonly resourceRevision: bigint;
  readonly traceId: string;
  readonly spanId: string;
  readonly receivedTraceparent?: string;
}
