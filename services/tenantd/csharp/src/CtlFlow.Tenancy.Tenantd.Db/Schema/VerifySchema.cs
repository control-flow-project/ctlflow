using Microsoft.EntityFrameworkCore;
using CtlFlow.Tenancy.Tenantd.Db;

namespace CtlFlow.Tenancy.Tenantd.Db.Schema;

public static partial class Schemas
{
    public static async Task<SchemaCompatibility> VerifySchema(
        IDbContextFactory<TenantDbContext> databaseContexts,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        var locks = await database.MigrationLocks.ToListAsync(
            queryCancellation);
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

        return SchemaCompatibility.Compatible;
    }
}
