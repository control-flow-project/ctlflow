namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public abstract record ResolveTenantResult
{
    private ResolveTenantResult()
    {
    }

    public sealed record Found(TenantResolution Resolution) : ResolveTenantResult;

    public sealed record NotFound : ResolveTenantResult;
}
