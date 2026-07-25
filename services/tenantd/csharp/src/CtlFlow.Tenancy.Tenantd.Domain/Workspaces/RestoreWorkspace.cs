using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class Workspaces
{
    public static ValueTask<Workspace> RestoreWorkspace(
        WorkspaceId id,
        TenantId tenantId,
        WorkspaceDisplayName displayName,
        LifecycleState lifecycle,
        WorkspaceRevision revision,
        WorkspaceProvisioningGeneration provisioningGeneration,
        LifecycleOperationId? currentOperationId,
        ResourceEventSequence lastEventSequence,
        UtcInstant createdAt,
        UtcInstant updatedAt,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new Workspace(
            id,
            tenantId,
            displayName,
            lifecycle,
            revision,
            provisioningGeneration,
            currentOperationId,
            lastEventSequence,
            createdAt,
            updatedAt));
    }
}
