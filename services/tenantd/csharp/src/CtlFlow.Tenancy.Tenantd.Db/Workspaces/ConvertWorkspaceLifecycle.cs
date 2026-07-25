using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

internal static class WorkspaceLifecycleStorage
{
    internal static int ToStorage(WorkspaceLifecycle lifecycle) =>
        lifecycle switch
        {
            (WorkspaceLifecycle)0 => 0,
            WorkspaceLifecycle.Provisioning => 1,
            WorkspaceLifecycle.Active => 2,
            WorkspaceLifecycle.Suspended => 3,
            WorkspaceLifecycle.Deleting => 4,
            WorkspaceLifecycle.Failed => 5,
            WorkspaceLifecycle.Deleted => 6,
            _ => throw new InvalidOperationException("Unknown Workspace lifecycle")
        };

    internal static WorkspaceLifecycle FromStorage(int value) =>
        value switch
        {
            0 => (WorkspaceLifecycle)0,
            1 => WorkspaceLifecycle.Provisioning,
            2 => WorkspaceLifecycle.Active,
            3 => WorkspaceLifecycle.Suspended,
            4 => WorkspaceLifecycle.Deleting,
            5 => WorkspaceLifecycle.Failed,
            6 => WorkspaceLifecycle.Deleted,
            _ => throw new InvalidOperationException(
                "Unknown stored Workspace lifecycle")
        };
}
