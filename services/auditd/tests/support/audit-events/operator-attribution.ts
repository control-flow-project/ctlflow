import type {
  AuditAttribution
} from "../../generated/v1/auditd.js";

export function operatorAttribution(
  commonName = "ctlflow-operator"
): AuditAttribution {
  return { operatorCommonName: commonName };
}
