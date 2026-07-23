using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using static CtlFlow.Tenancy.Tenantd.Db.Sqlite.SqliteDatabases;

namespace CtlFlow.Tenancy.Tenantd.Db.Sqlite;

public static partial class TenantDatabases
{
    public static ValueTask<PooledDbContextFactory<TenantDbContext>> CreateTenantDbContextFactory(
        DatabaseFilePath databasePath,
        DatabasePoolSize poolSize,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();

        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlite(CreateSqliteConnectionString(databasePath))
            .EnableDetailedErrors(false)
            .EnableSensitiveDataLogging(false)
            .Options;

        return ValueTask.FromResult(
            new PooledDbContextFactory<TenantDbContext>(options, poolSize.Value));
    }
}
