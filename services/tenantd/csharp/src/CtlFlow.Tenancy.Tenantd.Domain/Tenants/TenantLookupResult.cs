namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public abstract record TenantLookupResult
{
    private TenantLookupResult()
    {
    }

    public sealed record Found(TenantDetails Tenant) : TenantLookupResult;

    public sealed record NotFound : TenantLookupResult;
}
