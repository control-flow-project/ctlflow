import type {
  PlacementAuditTarget
} from "../../generated/v1/auditd.js";

export function tenantTarget(
  tenantId = "acme"
): PlacementAuditTarget {
  return { tenant: { tenantId } };
}
