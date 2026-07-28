using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using static CtlFlow.Policy.Policyd.Db.Sqlite.SqliteDatabases;

namespace CtlFlow.Policy.Policyd.Db.Sqlite;

internal static partial class SqliteDatabases
{
    internal static ValueTask<PooledDbContextFactory<PolicyDbContext>>
        CreateSqlitePolicyDbContextFactory(
            DatabaseFilePath databasePath,
            DatabasePoolSize poolSize,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        SQLitePCL.Batteries_V2.Init();
        var options = new DbContextOptionsBuilder<PolicyDbContext>()
            .UseSqlite(CreateSqliteConnectionString(databasePath))
            .EnableDetailedErrors(false)
            .EnableSensitiveDataLogging(false)
            .Options;
        return ValueTask.FromResult(
            new PooledDbContextFactory<PolicyDbContext>(
                options,
                poolSize.Value));
    }
}
