using CtlFlow.Tenancy.Tenantd.Domain.Collections;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public static partial class Tenants
{
    public static ValueTask<TenantPage> CreateTenantPage(
        IReadOnlyList<TenantDetails> candidates,
        PageSize pageSize,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (candidates.Count > pageSize.Value + 1)
        {
            throw new InvalidOperationException(
                "Tenant page candidate set is not bounded");
        }

        var hasNext = candidates.Count > pageSize.Value;
        var tenants = hasNext
            ? candidates.Take(pageSize.Value).ToArray()
            : candidates.ToArray();
        return ValueTask.FromResult(new TenantPage(
            tenants,
            hasNext ? tenants[^1].TenantId : null));
    }
}
