namespace CtlFlow.Tenancy.Tenantd.Service.Authorization;

internal enum TenantCapability
{
    ReadTenant,
    UpdateTenantDisplayName,
    CreateWorkspace,
    ReadWorkspace,
    UpdateWorkspaceDisplayName,
    SuspendWorkspace,
    ResumeWorkspace,
    DeleteWorkspace
}
