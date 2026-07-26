using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using static CtlFlow.Tenancy.Tenantd.Db.Sqlite.SqliteDatabases;

namespace CtlFlow.Tenancy.Tenantd.Db.Sqlite;

internal static partial class SqliteDatabases
{
    internal static ValueTask<PooledDbContextFactory<TenantDbContext>>
        CreateSqliteTenantDbContextFactory(
        DatabaseFilePath databasePath,
        DatabasePoolSize poolSize,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        SQLitePCL.Batteries_V2.Init();

        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlite(CreateSqliteConnectionString(databasePath))
            .EnableDetailedErrors(false)
            .EnableSensitiveDataLogging(false)
            .Options;

        return ValueTask.FromResult(
            new PooledDbContextFactory<TenantDbContext>(options, poolSize.Value));
    }
}
