export interface CapabilityGrant {
  readonly target: {
    readonly tenantId: string;
  };
  readonly subject: {
    readonly kind: "principal";
    readonly id: string;
  };
  readonly operation: string;
  readonly basePath: string;
  readonly match: "subtree";
}

export function createCapabilityGrants():
readonly CapabilityGrant[] {
  return [
    "placements.declare",
    "placements.read",
    "workloads.declare",
    "workloads.read",
    "runs.create",
    "runs.read",
    "runs.cancel"
  ].map((operation) => ({
    target: { tenantId: "tenant-a" },
    subject: {
      kind: "principal" as const,
      id: "user:alice"
    },
    operation,
    basePath: "/tenants/tenant-a",
    match: "subtree" as const
  }));
}
