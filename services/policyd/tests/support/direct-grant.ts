import type {
  PolicyGrant
} from "@ctlflow/policyd/testing/production";

export function directGrant(
  ownerId: string,
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
    owner: { kind: "kernel", id: ownerId },
    operation,
    basePath,
    match: "exact",
    ...overrides
  };
}

// A grant for a package-owned operation, namespaced by its Package ID.
export function packageGrant(
  packageId: string,
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
    owner: { kind: "package", id: packageId },
    operation,
    basePath,
    match: "exact",
    ...overrides
  };
}
