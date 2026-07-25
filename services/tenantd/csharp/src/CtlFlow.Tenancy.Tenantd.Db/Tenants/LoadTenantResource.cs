using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

internal static partial class TenantResources
{
    internal static async Task<TenantResource> LoadTenantResource(
        IDbContextFactory<TenantDbContext> databaseContexts,
        TenantId tenantId,
        CancellationToken cancellation)
    {
        var result = await Tenants.QueryTenantResource(
            databaseContexts,
            tenantId,
            cancellation);
        return result switch
        {
            ResourceLookupResult<TenantResource>.Found found =>
                found.Resource,
            _ => throw new InvalidOperationException(
                "Committed Tenant resource was not found")
        };
    }
}
