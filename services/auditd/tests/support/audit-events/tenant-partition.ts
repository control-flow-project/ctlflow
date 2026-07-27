import type {
  AuditPartition
} from "../../generated/v1/auditd.js";

export function tenantPartition(
  tenantId = "acme"
): AuditPartition {
  return { tenant: { tenantId } };
}
