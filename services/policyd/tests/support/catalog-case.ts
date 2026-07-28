export type PolicyOwner =
  | "tenantd"
  | "pkgd"
  | "configd"
  | "execd";

export interface CatalogCase {
  readonly operation: string;
  readonly owner: PolicyOwner;
  readonly resourcePath: string;
  readonly tenantId: string;
  readonly workspaceId?: string;
}

export const catalogCases: readonly CatalogCase[] = [
  {
    operation: "tenants.read",
    owner: "tenantd",
    resourcePath: "/tenants/acme",
    tenantId: "acme"
  },
  {
    operation: "tenants.update_display_name",
    owner: "tenantd",
    resourcePath: "/tenants/acme",
    tenantId: "acme"
  },
  {
    operation: "workspaces.create",
    owner: "tenantd",
    resourcePath: "/tenants/acme/workspaces",
    tenantId: "acme"
  },
  {
    operation: "workspaces.read",
    owner: "tenantd",
    resourcePath: "/tenants/acme/workspaces",
    tenantId: "acme"
  },
  {
    operation: "workspaces.update_display_name",
    owner: "tenantd",
    resourcePath: "/tenants/acme/workspaces/atlas",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "workspaces.suspend",
    owner: "tenantd",
    resourcePath: "/tenants/acme/workspaces/atlas",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "workspaces.resume",
    owner: "tenantd",
    resourcePath: "/tenants/acme/workspaces/atlas",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "workspaces.delete",
    owner: "tenantd",
    resourcePath: "/tenants/acme/workspaces/atlas",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "apps.create",
    owner: "pkgd",
    resourcePath: "/tenants/acme/apps",
    tenantId: "acme"
  },
  {
    operation: "apps.read",
    owner: "pkgd",
    resourcePath: "/tenants/acme/workspaces/atlas/apps/chat",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "apps.set_package_generation",
    owner: "pkgd",
    resourcePath: "/tenants/acme/accounts/user:alice/apps/chat",
    tenantId: "acme"
  },
  {
    operation: "configurations.publish",
    owner: "configd",
    resourcePath: "/tenants/acme/placements/core/consumers/chat/"
      + "purposes/runtime/configurations/main",
    tenantId: "acme"
  },
  {
    operation: "configurations.read",
    owner: "configd",
    resourcePath: "/tenants/acme/workspaces/atlas/placements/core/"
      + "consumers/chat/purposes/runtime/configurations/main",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "secrets.publish",
    owner: "configd",
    resourcePath: "/tenants/acme/accounts/user:alice/placements/private/"
      + "consumers/agent/purposes/runtime/secrets/token",
    tenantId: "acme"
  },
  {
    operation: "secrets.read_metadata",
    owner: "configd",
    resourcePath: "/tenants/acme/placements/core/consumers/chat/"
      + "purposes/runtime/secrets/token",
    tenantId: "acme"
  },
  {
    operation: "placements.declare",
    owner: "execd",
    resourcePath: "/tenants/acme/placements/core",
    tenantId: "acme"
  },
  {
    operation: "placements.read",
    owner: "execd",
    resourcePath: "/tenants/acme/workspaces/atlas/placements",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "workloads.declare",
    owner: "execd",
    resourcePath: "/tenants/acme/accounts/user:alice/placements/private/"
      + "workloads/reviewer",
    tenantId: "acme"
  },
  {
    operation: "workloads.read",
    owner: "execd",
    resourcePath: "/tenants/acme/placements/core/workloads",
    tenantId: "acme"
  },
  {
    operation: "runs.create",
    owner: "execd",
    resourcePath: "/tenants/acme/placements/core/workloads/chat/"
      + "runs/run_01",
    tenantId: "acme"
  },
  {
    operation: "runs.read",
    owner: "execd",
    resourcePath: "/tenants/acme/workspaces/atlas/placements/core/"
      + "workloads/chat/runs",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "runs.cancel",
    owner: "execd",
    resourcePath: "/tenants/acme/accounts/user:alice/placements/private/"
      + "workloads/reviewer/runs/run_01",
    tenantId: "acme"
  }
];
