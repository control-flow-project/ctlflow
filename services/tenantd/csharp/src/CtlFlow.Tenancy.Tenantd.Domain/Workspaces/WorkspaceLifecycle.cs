namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public enum WorkspaceLifecycle
{
    Provisioning = 1,
    Active = 2,
    Suspended = 3,
    Deleting = 4,
    Failed = 5,
    Deleted = 6
}
