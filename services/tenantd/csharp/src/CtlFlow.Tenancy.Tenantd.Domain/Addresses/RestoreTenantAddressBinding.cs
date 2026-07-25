using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Addresses;

public static partial class TenantAddresses
{
    public static ValueTask<TenantAddressBinding> RestoreTenantAddressBinding(
        TenantAddressBindingId id,
        TenantId tenantId,
        ExternalAuthority authority,
        TenantPathPrefix pathPrefix,
        AddressBindingGeneration bindingGeneration,
        bool isActive,
        UtcInstant createdAt,
        UtcInstant updatedAt,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new TenantAddressBinding(
            id,
            tenantId,
            authority,
            pathPrefix,
            bindingGeneration,
            isActive,
            createdAt,
            updatedAt));
    }
}
