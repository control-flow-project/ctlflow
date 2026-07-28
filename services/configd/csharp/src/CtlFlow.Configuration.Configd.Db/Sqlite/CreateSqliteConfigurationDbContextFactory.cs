using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using static CtlFlow.Configuration.Configd.Db.Sqlite.SqliteDatabases;

namespace CtlFlow.Configuration.Configd.Db.Sqlite;

internal static partial class SqliteDatabases
{
    internal static ValueTask<PooledDbContextFactory<ConfigurationDbContext>>
        CreateSqliteConfigurationDbContextFactory(
        DatabaseFilePath databasePath,
        DatabasePoolSize poolSize,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        SQLitePCL.Batteries_V2.Init();

        var options = new DbContextOptionsBuilder<ConfigurationDbContext>()
            .UseSqlite(CreateSqliteConnectionString(databasePath))
            .EnableDetailedErrors(false)
            .EnableSensitiveDataLogging(false)
            .Options;

        return ValueTask.FromResult(
            new PooledDbContextFactory<ConfigurationDbContext>(options, poolSize.Value));
    }
}
