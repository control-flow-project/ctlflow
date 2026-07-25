using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Schema;

public static partial class Schemas
{
    public static async Task<SchemaCompatibility> VerifyMigrationLedger(
        IDbContextFactory<TenantDbContext> databaseContexts,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "verify_migration_ledger");
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;

        var locks = await database.MigrationLocks
            .AsNoTracking()
            .Select(value => new
            {
                value.Index,
                value.IsLocked
            })
            .ToListAsync(queryCancellation);
        if (locks.Count != 1 || locks[0].IsLocked != 0)
        {
            return SchemaCompatibility.Different;
        }

        var appliedRows = await database.AppliedMigrations
            .AsNoTracking()
            .Select(value => new
            {
                Id = EF.Property<int>(value, "Id"),
                Name = EF.Property<string?>(value, "Name")
            })
            .ToListAsync(queryCancellation);
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
}
