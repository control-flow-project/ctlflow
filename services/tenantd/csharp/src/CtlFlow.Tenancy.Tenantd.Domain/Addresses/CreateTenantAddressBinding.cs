using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Addresses;

public static partial class TenantAddresses
{
    public static ValueTask<TenantAddressBinding> CreateTenantAddressBinding(
        TenantAddressBindingId id,
        TenantId tenantId,
        ExternalAuthority authority,
        TenantPathPrefix pathPrefix,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new TenantAddressBinding(
            id,
            tenantId,
            authority,
            pathPrefix,
            now));
    }
}
