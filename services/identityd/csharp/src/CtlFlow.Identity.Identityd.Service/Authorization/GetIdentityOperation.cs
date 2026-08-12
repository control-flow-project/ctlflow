using CtlFlow.Identity.Identityd.Service.Configuration;

namespace CtlFlow.Identity.Identityd.Service.Authorization;

internal static partial class IdentityAuthorization
{
    internal static string GetIdentityOperation(
        IdentityAdminOperation operation) => operation switch
        {
            IdentityAdminOperation.AddTenantMember =>
                "tenant_memberships.add",
            IdentityAdminOperation.RemoveTenantMember =>
                "tenant_memberships.remove",
            IdentityAdminOperation.ListTenantMembers =>
                "tenant_memberships.read",
            IdentityAdminOperation.AddWorkspaceMember =>
                "workspace_memberships.add",
            IdentityAdminOperation.RemoveWorkspaceMember =>
                "workspace_memberships.remove",
            IdentityAdminOperation.ListWorkspaceMembers =>
                "workspace_memberships.read",
            IdentityAdminOperation.CreateGroup => "groups.create",
            IdentityAdminOperation.DeleteGroup => "groups.delete",
            IdentityAdminOperation.ListGroups => "groups.read",
            IdentityAdminOperation.AddGroupMember =>
                "group_memberships.add",
            IdentityAdminOperation.RemoveGroupMember =>
                "group_memberships.remove",
            IdentityAdminOperation.ListGroupMembers =>
                "group_memberships.read",
            IdentityAdminOperation.CreateVirtualPrincipal =>
                "virtual_principals.create",
            IdentityAdminOperation.GetVirtualPrincipal or
                IdentityAdminOperation.ListVirtualPrincipals =>
                "virtual_principals.read",
            IdentityAdminOperation.SetVirtualPrincipalEnabled =>
                "virtual_principals.set_enabled",
            IdentityAdminOperation.CreateExternalIdentityLink =>
                "external_identity_links.create",
            IdentityAdminOperation.DeleteExternalIdentityLink =>
                "external_identity_links.delete",
            IdentityAdminOperation.ListExternalIdentityLinks =>
                "external_identity_links.read",
            IdentityAdminOperation.CreateLoginProvider =>
                "login_providers.create",
            IdentityAdminOperation.GetLoginProvider or
                IdentityAdminOperation.ListLoginProviders =>
                "login_providers.read",
            IdentityAdminOperation.UpdateLoginProvider =>
                "login_providers.update",
            IdentityAdminOperation.SetLoginProviderState =>
                "login_providers.set_state",
            IdentityAdminOperation.SetWorkspaceLoginProviderAdmission =>
                "workspace_login_provider_admissions.set",
            IdentityAdminOperation.GetWorkspaceLoginProviderAdmission or
                IdentityAdminOperation.ListWorkspaceLoginProviderAdmissions =>
                "workspace_login_provider_admissions.read",
            _ => throw new InvalidOperationException(
                "Identity administration operation is invalid")
        };
}
