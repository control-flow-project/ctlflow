import type {
  AuditAttributionEvidence,
  AuditPartitionEvidence
} from "../audit-event-evidence.js";

export interface StoredAuditEvent {
  readonly event_key: string;
  readonly source_event_id: string;
  readonly occurred_at_seconds: number;
  readonly occurred_at_nanoseconds: number;
  readonly attribution_kind: number;
  readonly operator_common_name: string | null;
  readonly workload_subject: string | null;
  readonly actor_principal_id: string | null;
  readonly attached_account_principal_id: string | null;
  readonly invocation_workload_subject: string | null;
  readonly partition_kind: number;
  readonly partition_tenant_id: string | null;
  readonly trace_id: string;
  readonly span_id: string;
  readonly detail_kind: number;
}

export interface AuditEnvelopeEvidence {
  readonly sourceEventId: string;
  readonly occurredAt: string;
  readonly attribution: AuditAttributionEvidence;
  readonly partition: AuditPartitionEvidence;
  readonly traceId: string;
  readonly spanId: string;
}

export function mapAuditEnvelope(
  row: StoredAuditEvent
): AuditEnvelopeEvidence {
  return {
    sourceEventId: row.source_event_id,
    occurredAt: new Date(
      row.occurred_at_seconds * 1_000
      + Math.floor(row.occurred_at_nanoseconds / 1_000_000))
      .toISOString(),
    attribution: mapAttribution(row),
    partition: mapPartition(row),
    traceId: row.trace_id,
    spanId: row.span_id
  };
}

function mapAttribution(
  row: StoredAuditEvent
): AuditAttributionEvidence {
  switch (row.attribution_kind) {
    case 1:
      return {
        kind: "operator",
        operatorCommonName: requireValue(row.operator_common_name)
      };
    case 2:
      return {
        kind: "workload",
        workloadSubject: requireValue(row.workload_subject)
      };
    case 3:
      return {
        kind: "invocation",
        actorPrincipalId: requireValue(row.actor_principal_id),
        attachedAccountPrincipalId: requireValue(
          row.attached_account_principal_id),
        workloadSubject: requireValue(
          row.invocation_workload_subject)
      };
    default:
      throw new Error("Stored audit attribution kind is invalid");
  }
}

function mapPartition(
  row: StoredAuditEvent
): AuditPartitionEvidence {
  switch (row.partition_kind) {
    case 1:
      return { kind: "global" };
    case 2:
      return {
        kind: "tenant",
        tenantId: requireValue(row.partition_tenant_id)
      };
    default:
      throw new Error("Stored audit partition kind is invalid");
  }
}

function requireValue(value: string | null): string {
  if (value === null) {
    throw new Error("Stored audit envelope is incomplete");
  }
  return value;
}
