using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class WorkspaceAddresses
{
    public static ValueTask<WorkspaceAddressBinding>
        CreateWorkspaceAddressBinding(
            WorkspaceAddressBindingId id,
            TenantId tenantId,
            WorkspaceId workspaceId,
            WorkspaceAddress workspaceAddress,
            UtcInstant now,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new WorkspaceAddressBinding(
            id,
            tenantId,
            workspaceId,
            workspaceAddress,
            now));
    }
}
