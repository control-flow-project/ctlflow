import type {
  IdentityCapability
} from "../authorization/allow-identity-capabilities.js";

export function createAdministrationCapabilities(
  namespace = "cross_cutting"
):
readonly IdentityCapability[] {
  const tenantId = "acme";
  const workspaceId = "atlas";
  const accountId = `user:${namespace}_admin`;
  const groupId = `${namespace}_admin_group`;
  const principalId = `agent:${namespace}_admin`;
  const providerId = `${namespace}_oidc`;
  const tenantRoot = `/tenants/${tenantId}`;
  const workspaceRoot = `${tenantRoot}/workspaces/${workspaceId}`;
  const memberPath = `${tenantRoot}/members/${accountId}`;
  const workspaceMemberPath = `${workspaceRoot}/members/${accountId}`;
  const groupPath = `${workspaceRoot}/groups/${groupId}`;
  const groupMemberPath = `${groupPath}/members/${accountId}`;
  const principalPath =
    `${workspaceRoot}/virtual-principals/${principalId}`;
  const providerPath = `${tenantRoot}/login-providers/${providerId}`;
  const identityLinksPath = `${providerPath}/identity-links`;
  const admissionPath =
    `${workspaceRoot}/login-providers/${providerId}`;

  return [
    tenant("tenant_memberships.add", memberPath),
    tenant("tenant_memberships.read", `${tenantRoot}/members`),
    tenant("tenant_memberships.remove", memberPath),
    tenant("workspace_memberships.add", workspaceMemberPath),
    tenant("workspace_memberships.read", `${workspaceRoot}/members`),
    tenant("workspace_memberships.remove", workspaceMemberPath),
    tenant("groups.create", groupPath),
    tenant("groups.read", `${workspaceRoot}/groups`),
    tenant("groups.delete", groupPath),
    tenant("group_memberships.add", groupMemberPath),
    tenant("group_memberships.read", `${groupPath}/members`),
    tenant("group_memberships.remove", groupMemberPath),
    tenant("virtual_principals.create", principalPath),
    tenant("virtual_principals.read", principalPath),
    tenant(
      "virtual_principals.read",
      `${workspaceRoot}/virtual-principals`),
    tenant("virtual_principals.set_enabled", principalPath),
    tenant("login_providers.create", providerPath),
    tenant("login_providers.read", providerPath),
    tenant("login_providers.read", `${tenantRoot}/login-providers`),
    tenant("login_providers.update", providerPath),
    tenant("login_providers.set_state", providerPath),
    tenant("workspace_login_provider_admissions.set", admissionPath),
    tenant(
      "workspace_login_provider_admissions.read",
      `${workspaceRoot}/login-providers`),
    tenant("external_identity_links.create", identityLinksPath),
    tenant("external_identity_links.read", identityLinksPath),
    tenant("external_identity_links.delete", identityLinksPath)
  ];

  function tenant(
    operation: string,
    resourcePath: string
  ): IdentityCapability {
    return { operation, resourcePath, tenantId };
  }
}
