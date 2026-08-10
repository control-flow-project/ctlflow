namespace CtlFlow.Identity.Identityd.Service.Configuration;

internal static partial class IdentitydConfiguration
{
    private static IdentityAdminSettings LoadIdentityAdminSettings() => new(
        new Dictionary<IdentityAdminOperation, IReadOnlySet<
            Security.Workloads.KubernetesServiceAccountSubject>>
        {
            [IdentityAdminOperation.AddTenantMember] =
                ParseRequiredCallers("CTLFLOW_ADD_TENANT_MEMBER_CALLERS"),
            [IdentityAdminOperation.RemoveTenantMember] =
                ParseRequiredCallers("CTLFLOW_REMOVE_TENANT_MEMBER_CALLERS"),
            [IdentityAdminOperation.ListTenantMembers] =
                ParseRequiredCallers("CTLFLOW_LIST_TENANT_MEMBERS_CALLERS"),
            [IdentityAdminOperation.AddWorkspaceMember] =
                ParseRequiredCallers("CTLFLOW_ADD_WORKSPACE_MEMBER_CALLERS"),
            [IdentityAdminOperation.RemoveWorkspaceMember] =
                ParseRequiredCallers("CTLFLOW_REMOVE_WORKSPACE_MEMBER_CALLERS"),
            [IdentityAdminOperation.ListWorkspaceMembers] =
                ParseRequiredCallers("CTLFLOW_LIST_WORKSPACE_MEMBERS_CALLERS"),
            [IdentityAdminOperation.CreateGroup] =
                ParseRequiredCallers("CTLFLOW_CREATE_GROUP_CALLERS"),
            [IdentityAdminOperation.DeleteGroup] =
                ParseRequiredCallers("CTLFLOW_DELETE_GROUP_CALLERS"),
            [IdentityAdminOperation.ListGroups] =
                ParseRequiredCallers("CTLFLOW_LIST_GROUPS_CALLERS"),
            [IdentityAdminOperation.AddGroupMember] =
                ParseRequiredCallers("CTLFLOW_ADD_GROUP_MEMBER_CALLERS"),
            [IdentityAdminOperation.RemoveGroupMember] =
                ParseRequiredCallers("CTLFLOW_REMOVE_GROUP_MEMBER_CALLERS"),
            [IdentityAdminOperation.ListGroupMembers] =
                ParseRequiredCallers("CTLFLOW_LIST_GROUP_MEMBERS_CALLERS"),
            [IdentityAdminOperation.CreateVirtualPrincipal] =
                ParseRequiredCallers("CTLFLOW_CREATE_VIRTUAL_PRINCIPAL_CALLERS"),
            [IdentityAdminOperation.GetVirtualPrincipal] =
                ParseRequiredCallers("CTLFLOW_GET_VIRTUAL_PRINCIPAL_CALLERS"),
            [IdentityAdminOperation.ListVirtualPrincipals] =
                ParseRequiredCallers("CTLFLOW_LIST_VIRTUAL_PRINCIPALS_CALLERS"),
            [IdentityAdminOperation.SetVirtualPrincipalEnabled] =
                ParseRequiredCallers("CTLFLOW_SET_VIRTUAL_PRINCIPAL_ENABLED_CALLERS"),
            [IdentityAdminOperation.CreateExternalIdentityLink] =
                ParseRequiredCallers("CTLFLOW_CREATE_EXTERNAL_IDENTITY_LINK_CALLERS"),
            [IdentityAdminOperation.DeleteExternalIdentityLink] =
                ParseRequiredCallers("CTLFLOW_DELETE_EXTERNAL_IDENTITY_LINK_CALLERS"),
            [IdentityAdminOperation.ListExternalIdentityLinks] =
                ParseRequiredCallers("CTLFLOW_LIST_EXTERNAL_IDENTITY_LINKS_CALLERS"),
            [IdentityAdminOperation.CreateLoginProvider] =
                ParseRequiredCallers("CTLFLOW_CREATE_LOGIN_PROVIDER_CALLERS"),
            [IdentityAdminOperation.GetLoginProvider] =
                ParseRequiredCallers("CTLFLOW_GET_LOGIN_PROVIDER_CALLERS"),
            [IdentityAdminOperation.ListLoginProviders] =
                ParseRequiredCallers("CTLFLOW_LIST_LOGIN_PROVIDERS_CALLERS"),
            [IdentityAdminOperation.UpdateLoginProvider] =
                ParseRequiredCallers("CTLFLOW_UPDATE_LOGIN_PROVIDER_CALLERS"),
            [IdentityAdminOperation.SetLoginProviderState] =
                ParseRequiredCallers("CTLFLOW_SET_LOGIN_PROVIDER_STATE_CALLERS"),
            [IdentityAdminOperation.SetWorkspaceLoginProviderAdmission] =
                ParseRequiredCallers("CTLFLOW_SET_WORKSPACE_LOGIN_PROVIDER_ADMISSION_CALLERS"),
            [IdentityAdminOperation.ListWorkspaceLoginProviderAdmissions] =
                ParseRequiredCallers("CTLFLOW_LIST_WORKSPACE_LOGIN_PROVIDER_ADMISSIONS_CALLERS")
        });
}
