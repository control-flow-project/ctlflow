namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public enum AuditOperation
{
    CreateTenant = 1,
    UpdateTenant = 2,
    SetTenantState = 3,
    CreateWorkspace = 4,
    UpdateWorkspace = 5,
    SetWorkspaceState = 6
}
