using CtlFlow.Tenancy.Tenantd.Db.Providers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Schema;

public static partial class Schemas
{
    public static async Task<SchemaCompatibility> VerifySchema(
        TenantDatabase tenantDatabase,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "verify_schema");
        var ledger = await VerifyMigrationLedger(tenantDatabase, cancellation);
        if (ledger != SchemaCompatibility.Compatible)
        {
            return ledger;
        }

        await using var database = await tenantDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        await database.Tenants
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
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.Workspaces
            .AsNoTracking()
            .OrderBy(workspace => EF.Property<string>(workspace, "_id"))
            .Select(workspace => new
            {
                Id = EF.Property<string>(workspace, "_id"),
                TenantId = EF.Property<string>(workspace, "_tenantId"),
                Address = EF.Property<string>(workspace, "_address"),
                workspace.DisplayName,
                workspace.State,
                workspace.Revision,
                workspace.CreatedAt,
                workspace.UpdatedAt
            })
            .Take(1)
            .ToListAsync(queryCancellation);

        return SchemaCompatibility.Compatible;
    }
}
