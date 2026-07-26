using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.TenantMappings;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

public static partial class Tenants
{
    public static async Task<TenantMutationResult> CreateTenant(
        TenantDatabase tenantDatabase,
        TenantId tenantId,
        ResourceAddress address,
        DisplayName displayName,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = TenantDbTelemetry.StartOperation("create_tenant");
        var decision = await ClassifyTenantCreation(
            tenantDatabase,
            tenantId,
            address,
            displayName,
            audit,
            cancellation);
        if (decision is not TenantMutationResult.Changed changed)
        {
            return decision;
        }

        await using var database = await tenantDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        database.Tenants.Add(changed.Tenant);
        try
        {
            await database.SaveChangesAsync(cancellation);
            return changed;
        }
        catch (DbUpdateException exception)
        {
            var retry = await ClassifyTenantCreation(
                tenantDatabase,
                tenantId,
                address,
                displayName,
                audit,
                cancellation);
            if (retry is TenantMutationResult.Changed)
            {
                throw new InvalidOperationException(
                    "Tenant creation failed without an ownership conflict",
                    exception);
            }

            return retry;
        }
    }

    private static async Task<TenantMutationResult> ClassifyTenantCreation(
        TenantDatabase tenantDatabase,
        TenantId tenantId,
        ResourceAddress address,
        DisplayName displayName,
        AuditContext audit,
        CancellationToken cancellation)
    {
        await using var database = await tenantDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        var tenantIdValue = tenantId.Value;
        var addressValue = address.Value;
        var queryCancellation = cancellation;
        var byId = await database.Tenants
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
        var byAddress = await database.Tenants
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

        return await Domain.Tenants.Tenants.CreateTenant(
            tenantId,
            address,
            displayName,
            byId is null
                ? null
                : CreateTenantDetails(
                    byId.Id,
                    byId.Address,
                    byId.DisplayName,
                    byId.State,
                    byId.Revision,
                    byId.CreatedAt,
                    byId.UpdatedAt),
            byAddress is null
                ? null
                : CreateTenantDetails(
                    byAddress.Id,
                    byAddress.Address,
                    byAddress.DisplayName,
                    byAddress.State,
                    byAddress.Revision,
                    byAddress.CreatedAt,
                    byAddress.UpdatedAt),
            audit,
            cancellation);
    }
}
