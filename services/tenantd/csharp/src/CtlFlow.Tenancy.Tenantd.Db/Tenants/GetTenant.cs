using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.TenantMappings;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

public static partial class Tenants
{
    public static async Task<TenantLookupResult> GetTenant(
        TenantDatabase tenantDatabase,
        TenantId tenantId,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = TenantDbTelemetry.StartOperation("get_tenant");
        await using var database = await tenantDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        var tenantIdValue = tenantId.Value;
        var queryCancellation = cancellation;
        var row = await database.Tenants
            .AsNoTracking()
            .Where(tenant =>
                EF.Property<string>(tenant, "_id") == tenantIdValue)
            .Select(tenant => new
            {
                Id = EF.Property<string>(tenant, "_id"),
                Address = EF.Property<string>(tenant, "_address"),
                tenant.DisplayName,
                tenant.State,
                tenant.Revision,
                tenant.CreatedAt,
                tenant.UpdatedAt
            })
            .SingleOrDefaultAsync(queryCancellation);

        return row is null
            ? new TenantLookupResult.NotFound()
            : new TenantLookupResult.Found(CreateTenantDetails(
                row.Id,
                row.Address,
                row.DisplayName,
                row.State,
                row.Revision,
                row.CreatedAt,
                row.UpdatedAt));
    }
}
