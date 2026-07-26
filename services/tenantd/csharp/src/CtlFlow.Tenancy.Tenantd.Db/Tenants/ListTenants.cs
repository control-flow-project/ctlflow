using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.TenantMappings;
using static CtlFlow.Tenancy.Tenantd.Domain.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

public static partial class Tenants
{
    public static async Task<TenantPage> ListTenants(
        TenantDatabase tenantDatabase,
        PageSize pageSize,
        TenantId? afterTenantId,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = TenantDbTelemetry.StartOperation("list_tenants");
        await using var database = await tenantDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        var take = pageSize.Value + 1;
        TenantDetails[] candidates;

        if (afterTenantId is null)
        {
            var rows = await database.Tenants
                .AsNoTracking()
                .OrderBy(tenant => EF.Property<string>(tenant, "_id"))
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
                .Take(take)
                .ToListAsync(queryCancellation);
            candidates = rows
                .Select(row => CreateTenantDetails(
                    row.Id,
                    row.Address,
                    row.DisplayName,
                    row.State,
                    row.Revision,
                    row.CreatedAt,
                    row.UpdatedAt))
                .ToArray();
        }
        else
        {
            var afterValue = afterTenantId.Value;
            var rows = await database.Tenants
                .AsNoTracking()
                .Where(tenant =>
                    string.Compare(
                        EF.Property<string>(tenant, "_id"),
                        afterValue) > 0)
                .OrderBy(tenant => EF.Property<string>(tenant, "_id"))
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
                .Take(take)
                .ToListAsync(queryCancellation);
            candidates = rows
                .Select(row => CreateTenantDetails(
                    row.Id,
                    row.Address,
                    row.DisplayName,
                    row.State,
                    row.Revision,
                    row.CreatedAt,
                    row.UpdatedAt))
                .ToArray();
        }

        return await CreateTenantPage(candidates, pageSize, cancellation);
    }
}
