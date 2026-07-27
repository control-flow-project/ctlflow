import type {
  AuditAttribution
} from "../../generated/v1/auditd.js";

export function workloadAttribution(
  workloadSubject: string
): AuditAttribution {
  return { workloadSubject };
}
