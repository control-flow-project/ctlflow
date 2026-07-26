using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.TenantMappings;
using static CtlFlow.Tenancy.Tenantd.Domain.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

public static partial class Tenants
{
    public static async Task<TenantResolutionResult> ResolveTenant(
        TenantDatabase tenantDatabase,
        ResourceAddress address,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = TenantDbTelemetry.StartOperation(
            "resolve_tenant");
        await using var database = await tenantDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        var addressValue = address.Value;
        var queryCancellation = cancellation;
        var row = await database.Tenants
            .AsNoTracking()
            .Where(tenant =>
                EF.Property<string>(tenant, "_address") == addressValue)
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
        var candidate = row is null
            ? null
            : CreateTenantDetails(
                row.Id,
                row.Address,
                row.DisplayName,
                row.State,
                row.Revision,
                row.CreatedAt,
                row.UpdatedAt);
        return await Domain.Tenants.Tenants.ResolveTenant(
            candidate,
            cancellation);
    }
}
