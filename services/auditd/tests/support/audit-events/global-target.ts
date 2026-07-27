import type {
  PlacementAuditTarget
} from "../../generated/v1/auditd.js";

export function globalTarget(): PlacementAuditTarget {
  return { global: {} };
}
