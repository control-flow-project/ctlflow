using CtlFlow.Tenancy.Tenantd.Domain.Resources;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public abstract record TenantResolutionResult
{
    private TenantResolutionResult()
    {
    }

    public sealed record Found(
        TenantId TenantId,
        ResourceState State,
        Revision Revision) : TenantResolutionResult;

    public sealed record NotFound : TenantResolutionResult;
}
