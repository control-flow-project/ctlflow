using Microsoft.EntityFrameworkCore;
using CtlFlow.Tenancy.Tenantd.Db;

namespace CtlFlow.Tenancy.Tenantd.Db.Schema;

public static partial class Schemas
{
    // Per-request gate: only the cheap migration-ledger check. Table
    // compatibility is not probed here because each operation naturally fails
    // against its own tables (the query throws, mapped to UNAVAILABLE), so a
    // renamed or incompatible table is still caught without four extra probes
    // on every request. The DbContext is a local so EF query precompilation
    // can translate these queries.
    public static async Task<SchemaCompatibility> VerifyMigrationLedger(
        IDbContextFactory<TenantDbContext> databaseContexts,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        // A local, not the parameter: EF query precompilation cannot translate a
        // ParameterSymbol passed to a query terminal.
        var queryCancellation = cancellation;

        var locks = await database.MigrationLocks.ToListAsync(queryCancellation);
        if (locks.Count != 1 || locks[0].IsLocked != 0)
        {
            return SchemaCompatibility.Different;
        }

        var appliedRows = await database.AppliedMigrations.ToListAsync(
            queryCancellation);
        var applied = appliedRows
            .OrderBy(value => value.Id)
            .Select(value => value.Name)
            .ToArray();

        if (applied.Length == 0)
        {
            return SchemaCompatibility.Missing;
        }

        var expected = ReadExpectedMigrationNames();
        if (applied.Length != expected.Count)
        {
            return SchemaCompatibility.Different;
        }

        for (var index = 0; index < expected.Count; index++)
        {
            if (!string.Equals(
                    applied[index],
                    expected[index],
                    StringComparison.Ordinal))
            {
                return SchemaCompatibility.Different;
            }
        }

        return SchemaCompatibility.Compatible;
    }

    // Readiness-wide check: the ledger plus a probe of every mapped table, so
    // /readyz proves the whole schema is serveable, not just the current
    // operation's tables.
    public static async Task<SchemaCompatibility> VerifySchema(
        IDbContextFactory<TenantDbContext> databaseContexts,
        CancellationToken cancellation)
    {
        var ledger = await VerifyMigrationLedger(databaseContexts, cancellation);
        if (ledger != SchemaCompatibility.Compatible)
        {
            return ledger;
        }

        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;

        await database.Tenants
            .AsNoTracking()
            .OrderBy(tenant => EF.Property<string>(tenant, "_id"))
            .Select(tenant => new
            {
                Id = EF.Property<string>(tenant, "_id"),
                tenant.DisplayName,
                tenant.Lifecycle,
                tenant.Revision,
                tenant.ProvisioningGeneration,
                tenant.CreatedAt,
                tenant.UpdatedAt
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.TenantAddressBindings
            .AsNoTracking()
            .OrderBy(address => address.Id)
            .Select(address => new
            {
                address.Id,
                TenantId = EF.Property<string>(address, "_tenantId"),
                Authority = EF.Property<string>(address, "_authority"),
                PathPrefix = EF.Property<string>(address, "_pathPrefix"),
                address.BindingGeneration,
                address.IsActive,
                address.CreatedAt,
                address.UpdatedAt
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
                workspace.DisplayName,
                workspace.Lifecycle,
                workspace.Revision,
                workspace.ProvisioningGeneration,
                workspace.CreatedAt,
                workspace.UpdatedAt
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.WorkspaceAddressBindings
            .AsNoTracking()
            .OrderBy(address => address.Id)
            .Select(address => new
            {
                address.Id,
                TenantId = EF.Property<string>(address, "_tenantId"),
                WorkspaceId = EF.Property<string>(address, "_workspaceId"),
                WorkspaceAddress = EF.Property<string>(address, "_workspaceAddress"),
                address.BindingGeneration,
                address.IsActive,
                address.CreatedAt,
                address.UpdatedAt
            })
            .Take(1)
            .ToListAsync(queryCancellation);

        return SchemaCompatibility.Compatible;
    }
}
