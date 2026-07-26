using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class Workspaces
{
    public static ValueTask<Workspace> RestoreWorkspace(
        WorkspaceId workspaceId,
        TenantId tenantId,
        ResourceAddress address,
        DisplayName displayName,
        ResourceState state,
        Revision revision,
        UtcInstant createdAt,
        UtcInstant updatedAt,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!Enum.IsDefined(state) || updatedAt.Value < createdAt.Value)
        {
            throw new InvalidOperationException("Stored Workspace state is invalid");
        }

        return ValueTask.FromResult(new Workspace(
            workspaceId,
            tenantId,
            address,
            displayName,
            state,
            revision,
            createdAt,
            updatedAt));
    }
}
