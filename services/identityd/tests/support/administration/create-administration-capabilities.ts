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
    workspace("workspace_memberships.add", workspaceMemberPath),
    workspace("workspace_memberships.read", `${workspaceRoot}/members`),
    workspace("workspace_memberships.remove", workspaceMemberPath),
    workspace("groups.create", groupPath),
    workspace("groups.read", `${workspaceRoot}/groups`),
    workspace("groups.delete", groupPath),
    workspace("group_memberships.add", groupMemberPath),
    workspace("group_memberships.read", `${groupPath}/members`),
    workspace("group_memberships.remove", groupMemberPath),
    workspace("virtual_principals.create", principalPath),
    workspace("virtual_principals.read", principalPath),
    workspace(
      "virtual_principals.read",
      `${workspaceRoot}/virtual-principals`),
    workspace("virtual_principals.set_enabled", principalPath),
    tenant("login_providers.create", providerPath),
    tenant("login_providers.read", providerPath),
    tenant("login_providers.read", `${tenantRoot}/login-providers`),
    tenant("login_providers.update", providerPath),
    tenant("login_providers.set_state", providerPath),
    workspace("workspace_login_provider_admissions.set", admissionPath),
    workspace(
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

  function workspace(
    operation: string,
    resourcePath: string
  ): IdentityCapability {
    return { operation, resourcePath, tenantId, workspaceId };
  }
}
