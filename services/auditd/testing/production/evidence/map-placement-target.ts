import type {
  PlacementAuditTargetEvidence
} from "../audit-event-evidence.js";

export function mapPlacementTarget(
  kind: number,
  tenantId: string | null,
  workspaceId: string | null,
  accountPrincipalId: string | null
): PlacementAuditTargetEvidence {
  switch (kind) {
    case 1:
      return { kind: "global" };
    case 2:
      return {
        kind: "tenant",
        tenantId: requireValue(tenantId)
      };
    case 3:
      return {
        kind: "workspace",
        tenantId: requireValue(tenantId),
        workspaceId: requireValue(workspaceId)
      };
    case 4:
      return {
        kind: "user",
        tenantId: requireValue(tenantId),
        accountPrincipalId: requireValue(accountPrincipalId)
      };
    default:
      throw new Error("Stored audit target kind is invalid");
  }
}

function requireValue(value: string | null): string {
  if (value === null) {
    throw new Error("Stored audit target is incomplete");
  }
  return value;
}
