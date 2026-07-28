import type {
  PolicyGrant
} from "@ctlflow/policyd/testing/production";

export function directGrant(
  operation: string,
  basePath: string,
  overrides: Partial<PolicyGrant> = {}
): PolicyGrant {
  return {
    target: { tenantId: "acme" },
    subject: {
      kind: "principal",
      id: "user:alice"
    },
    operation,
    basePath,
    match: "exact",
    ...overrides
  };
}
