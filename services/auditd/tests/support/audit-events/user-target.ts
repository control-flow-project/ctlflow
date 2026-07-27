import type {
  PlacementAuditTarget
} from "../../generated/v1/auditd.js";

export function userTarget(
  tenantId = "acme",
  accountPrincipalId = "user:maya"
): PlacementAuditTarget {
  return { user: { tenantId, accountPrincipalId } };
}
