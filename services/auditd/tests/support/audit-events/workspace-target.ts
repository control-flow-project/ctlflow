import type {
  PlacementAuditTarget
} from "../../generated/v1/auditd.js";

export function workspaceTarget(
  tenantId = "acme",
  workspaceId = "atlas"
): PlacementAuditTarget {
  return { workspace: { tenantId, workspaceId } };
}
