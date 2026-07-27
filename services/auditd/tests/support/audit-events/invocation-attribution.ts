import type {
  AuditAttribution
} from "../../generated/v1/auditd.js";

export function invocationAttribution(
  workloadSubject: string,
  actorPrincipalId = "user:maya",
  attachedAccountPrincipalId = "user:maya"
): AuditAttribution {
  return {
    invocation: {
      actorPrincipalId,
      attachedAccountPrincipalId,
      workloadSubject
    }
  };
}
