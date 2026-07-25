using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class WorkspaceAddresses
{
    public static ValueTask<WorkspaceAddressBinding>
        RestoreWorkspaceAddressBinding(
            WorkspaceAddressBindingId id,
            TenantId tenantId,
            WorkspaceId workspaceId,
            WorkspaceAddress workspaceAddress,
            AddressBindingGeneration bindingGeneration,
            bool isActive,
            UtcInstant createdAt,
            UtcInstant updatedAt,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new WorkspaceAddressBinding(
            id,
            tenantId,
            workspaceId,
            workspaceAddress,
            bindingGeneration,
            isActive,
            createdAt,
            updatedAt));
    }
}
