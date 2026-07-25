using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal static partial class LifecycleWork
{
    internal static LifecycleTarget RestoreLifecycleTarget(
        int targetKind,
        string tenantId,
        string? workspaceId) =>
        targetKind switch
        {
            1 => new LifecycleTarget.Tenant(
                TenantId.FromStorage(tenantId)),
            2 => new LifecycleTarget.Workspace(
                TenantId.FromStorage(tenantId),
                WorkspaceId.FromStorage(workspaceId!)),
            _ => throw new InvalidOperationException(
                "Stored lifecycle target kind is invalid")
        };
}
