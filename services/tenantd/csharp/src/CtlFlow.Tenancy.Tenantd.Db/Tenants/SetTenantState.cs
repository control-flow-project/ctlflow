using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

public static partial class Tenants
{
    public static async Task<TenantMutationResult> SetTenantState(
        TenantDatabase tenantDatabase,
        TenantId tenantId,
        Revision expectedRevision,
        ResourceState desiredState,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = TenantDbTelemetry.StartOperation(
            "set_tenant_state");
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

        var workspaceStates = await database.Workspaces
            .AsNoTracking()
            .Where(workspace =>
                EF.Property<string>(workspace, "_tenantId") == tenantIdValue)
            .Select(workspace => workspace.State)
            .ToListAsync(queryCancellation);
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
        var decision = await Domain.Tenants.Tenants.SetTenantState(
            tenant,
            expectedRevision,
            desiredState,
            workspaceStates,
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
