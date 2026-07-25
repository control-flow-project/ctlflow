export interface AuditEventEvidence {
  readonly sourceEventId: string;
  readonly sourceSequence: string;
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly occurredAt: string;
  readonly operatorSubject: string;
  readonly immediateCaller?: string;
  readonly tenantId: string;
  readonly target:
    | {
        readonly kind: "tenant";
        readonly tenantId: string;
      }
    | {
        readonly kind: "workspace";
        readonly tenantId: string;
        readonly workspaceId: string;
      };
  readonly resourceRevision: string;
  readonly outcome: "succeeded";
  readonly traceId: string;
  readonly spanId: string;
  readonly partitionCursor: string;
}
