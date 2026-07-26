using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public static partial class Tenants
{
    public static ValueTask<Tenant> RestoreTenant(
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
            throw new InvalidOperationException("Stored Tenant state is invalid");
        }

        return ValueTask.FromResult(new Tenant(
            tenantId,
            address,
            displayName,
            state,
            revision,
            createdAt,
            updatedAt));
    }
}
