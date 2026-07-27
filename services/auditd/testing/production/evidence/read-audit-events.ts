import type {
  Knex
} from "knex";
import type {
  AuditEventEvidence
} from "../audit-event-evidence.js";
import {
  mapAuditEnvelope,
  type StoredAuditEvent
} from "./map-audit-envelope.js";
import {
  readAuditDetail
} from "./read-audit-detail.js";

export async function readAuditEvents(
  database: Knex,
  sourceSubject: string
): Promise<readonly AuditEventEvidence[]> {
  const rows = await database
    .select<StoredAuditEvent[]>(
      "event_key",
      "source_event_id",
      "occurred_at_seconds",
      "occurred_at_nanoseconds",
      "attribution_kind",
      "operator_common_name",
      "workload_subject",
      "actor_principal_id",
      "attached_account_principal_id",
      "invocation_workload_subject",
      "partition_kind",
      "partition_tenant_id",
      "trace_id",
      "span_id",
      "detail_kind")
    .from("audit_events")
    .where("source_subject", sourceSubject)
    .orderByRaw("rowid ASC");
  const evidence: AuditEventEvidence[] = [];
  for (const row of rows) {
    const detail = await readAuditDetail(
      database,
      row.event_key,
      row.detail_kind);
    evidence.push({
      ...mapAuditEnvelope(row),
      ...detail
    } as AuditEventEvidence);
  }
  return evidence;
}
