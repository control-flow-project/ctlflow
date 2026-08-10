namespace CtlFlow.Identity.Identityd.Service.Configuration;

internal enum IdentityAdminOperation
{
    AddTenantMember,
    RemoveTenantMember,
    ListTenantMembers,
    AddWorkspaceMember,
    RemoveWorkspaceMember,
    ListWorkspaceMembers,
    CreateGroup,
    DeleteGroup,
    ListGroups,
    AddGroupMember,
    RemoveGroupMember,
    ListGroupMembers,
    CreateVirtualPrincipal,
    GetVirtualPrincipal,
    ListVirtualPrincipals,
    SetVirtualPrincipalEnabled,
    CreateExternalIdentityLink,
    DeleteExternalIdentityLink,
    ListExternalIdentityLinks,
    CreateLoginProvider,
    GetLoginProvider,
    ListLoginProviders,
    UpdateLoginProvider,
    SetLoginProviderState,
    SetWorkspaceLoginProviderAdmission,
    ListWorkspaceLoginProviderAdmissions
}
