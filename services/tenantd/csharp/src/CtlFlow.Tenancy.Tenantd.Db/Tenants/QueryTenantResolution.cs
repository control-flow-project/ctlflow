using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Caching;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

public static partial class Tenants
{
    public static async Task<ResolveTenantResult> QueryTenantResolution(
        IDbContextFactory<TenantDbContext> databaseContexts,
        TenantSelector selector,
        CacheLifetime cacheLifetime,
        UtcInstant currentTime,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        var cacheExpiry = CacheExpiry.Calculate(currentTime, cacheLifetime);

        if (selector is TenantSelector.ById byId)
        {
            var tenantId = byId.TenantId.Value;
            var row = await database.Tenants
                .AsNoTracking()
                .Where(tenant =>
                    EF.Property<string>(tenant, "_id") == tenantId)
                .Select(tenant => new
                {
                    Id = EF.Property<string>(tenant, "_id"),
                    tenant.Lifecycle,
                    tenant.Revision
                })
                .SingleOrDefaultAsync(queryCancellation);

            return row is null
                ? new ResolveTenantResult.NotFound()
                : new ResolveTenantResult.Found(
                    new TenantResolution(
                        TenantId.FromStorage(row.Id),
                        row.Lifecycle,
                        row.Revision,
                        null,
                        cacheExpiry));
        }

        if (selector is TenantSelector.ByExternalAddress byAddress)
        {
            var authority = byAddress.Authority.Value;
            var pathPrefix = byAddress.PathPrefix.Value;
            var row = await database.TenantAddressBindings
                .AsNoTracking()
                .Where(address =>
                    EF.Property<string>(address, "_authority") == authority
                    && EF.Property<string>(address, "_pathPrefix") == pathPrefix
                    && address.IsActive)
                .Join(
                    database.Tenants
                        .AsNoTracking()
                        .Where(tenant =>
                            tenant.Lifecycle == TenantLifecycle.Active),
                    address => EF.Property<string>(address, "_tenantId"),
                    tenant => EF.Property<string>(tenant, "_id"),
                    (address, tenant) => new
                    {
                        Id = EF.Property<string>(tenant, "_id"),
                        tenant.Lifecycle,
                        tenant.Revision,
                        address.BindingGeneration
                    })
                .SingleOrDefaultAsync(queryCancellation);

            return row is null
                ? new ResolveTenantResult.NotFound()
                : new ResolveTenantResult.Found(
                    new TenantResolution(
                        TenantId.FromStorage(row.Id),
                        row.Lifecycle,
                        row.Revision,
                        row.BindingGeneration,
                        cacheExpiry));
        }

        throw new UnreachableException();
    }
}
