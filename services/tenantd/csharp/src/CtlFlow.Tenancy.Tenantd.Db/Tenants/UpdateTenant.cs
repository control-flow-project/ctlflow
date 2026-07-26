using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

public static partial class Tenants
{
    public static async Task<TenantMutationResult> UpdateTenant(
        TenantDatabase tenantDatabase,
        TenantId tenantId,
        Revision expectedRevision,
        DisplayName displayName,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = TenantDbTelemetry.StartOperation("update_tenant");
        await using var mutation =
            await tenantDatabase.AcquireMutation(tenantId, cancellation);
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
        if (row is null)
        {
            return new TenantMutationResult.NotFound();
        }

        var tenant = await Domain.Tenants.Tenants.RestoreTenant(
            TenantId.FromStorage(row.Id),
            Domain.Addresses.ResourceAddress.FromStorage(row.Address),
            row.DisplayName,
            row.State,
            row.Revision,
            row.CreatedAt,
            row.UpdatedAt,
            cancellation);
        database.Attach(tenant);
        var decision = await Domain.Tenants.Tenants.UpdateTenantDisplayName(
            tenant,
            expectedRevision,
            displayName,
            audit,
            cancellation);
        if (decision is not TenantMutationResult.Changed)
        {
            return decision;
        }

        try
        {
            await database.SaveChangesAsync(queryCancellation);
            return decision;
        }
        catch (DbUpdateConcurrencyException)
        {
            return new TenantMutationResult.RevisionMismatch();
        }
    }
}
