export type PolicyOwner =
  | "tenantd"
  | "pkgd"
  | "configd"
  | "execd"
  | "identityd";

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
    operation: "tenant_memberships.add",
    owner: "identityd",
    resourcePath: "/tenants/acme/members/user:bob",
    tenantId: "acme"
  },
  {
    operation: "tenant_memberships.remove",
    owner: "identityd",
    resourcePath: "/tenants/acme/members/user:bob",
    tenantId: "acme"
  },
  {
    operation: "tenant_memberships.read",
    owner: "identityd",
    resourcePath: "/tenants/acme/members",
    tenantId: "acme"
  },
  {
    operation: "workspace_memberships.add",
    owner: "identityd",
    resourcePath: "/tenants/acme/workspaces/atlas/members/user:bob",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "workspace_memberships.remove",
    owner: "identityd",
    resourcePath: "/tenants/acme/workspaces/atlas/members/user:bob",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "workspace_memberships.read",
    owner: "identityd",
    resourcePath: "/tenants/acme/workspaces/atlas/members",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "groups.create",
    owner: "identityd",
    resourcePath: "/tenants/acme/groups/reviewers",
    tenantId: "acme"
  },
  {
    operation: "groups.delete",
    owner: "identityd",
    resourcePath: "/tenants/acme/workspaces/atlas/groups/reviewers",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "groups.read",
    owner: "identityd",
    resourcePath: "/tenants/acme/workspaces/atlas/groups",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "group_memberships.add",
    owner: "identityd",
    resourcePath: "/tenants/acme/groups/reviewers/members/user:alice",
    tenantId: "acme"
  },
  {
    operation: "group_memberships.remove",
    owner: "identityd",
    resourcePath: "/tenants/acme/workspaces/atlas/groups/reviewers/"
      + "members/agent:reviewer",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "group_memberships.read",
    owner: "identityd",
    resourcePath: "/tenants/acme/groups/reviewers/members",
    tenantId: "acme"
  },
  {
    operation: "virtual_principals.create",
    owner: "identityd",
    resourcePath: "/tenants/acme/virtual-principals/agent:reviewer",
    tenantId: "acme"
  },
  {
    operation: "virtual_principals.read",
    owner: "identityd",
    resourcePath: "/tenants/acme/workspaces/atlas/virtual-principals",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "virtual_principals.set_enabled",
    owner: "identityd",
    resourcePath: "/tenants/acme/virtual-principals/agent:reviewer",
    tenantId: "acme"
  },
  {
    operation: "external_identity_links.create",
    owner: "identityd",
    resourcePath: "/tenants/acme/login-providers/workforce/identity-links",
    tenantId: "acme"
  },
  {
    operation: "external_identity_links.delete",
    owner: "identityd",
    resourcePath: "/tenants/acme/login-providers/workforce/identity-links",
    tenantId: "acme"
  },
  {
    operation: "external_identity_links.read",
    owner: "identityd",
    resourcePath: "/tenants/acme/login-providers/workforce/identity-links",
    tenantId: "acme"
  },
  {
    operation: "login_providers.create",
    owner: "identityd",
    resourcePath: "/tenants/acme/login-providers/workforce",
    tenantId: "acme"
  },
  {
    operation: "login_providers.read",
    owner: "identityd",
    resourcePath: "/tenants/acme/login-providers",
    tenantId: "acme"
  },
  {
    operation: "login_providers.update",
    owner: "identityd",
    resourcePath: "/tenants/acme/login-providers/workforce",
    tenantId: "acme"
  },
  {
    operation: "login_providers.set_state",
    owner: "identityd",
    resourcePath: "/tenants/acme/login-providers/workforce",
    tenantId: "acme"
  },
  {
    operation: "workspace_login_provider_admissions.set",
    owner: "identityd",
    resourcePath: "/tenants/acme/workspaces/atlas/login-providers/workforce",
    tenantId: "acme",
    workspaceId: "atlas"
  },
  {
    operation: "workspace_login_provider_admissions.read",
    owner: "identityd",
    resourcePath: "/tenants/acme/workspaces/atlas/login-providers",
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
