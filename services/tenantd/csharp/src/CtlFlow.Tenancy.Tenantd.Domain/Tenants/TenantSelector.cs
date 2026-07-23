using CtlFlow.Tenancy.Tenantd.Domain.Addresses;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public abstract record TenantSelector
{
    private TenantSelector()
    {
    }

    public sealed record ById(TenantId TenantId) : TenantSelector;

    public sealed record ByExternalAddress(
        ExternalAuthority Authority,
        TenantPathPrefix PathPrefix) : TenantSelector;
}
