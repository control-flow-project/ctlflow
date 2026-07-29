using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using static CtlFlow.Execution.Execd.Db.Sqlite.SqliteDatabases;

namespace CtlFlow.Execution.Execd.Db.Sqlite;

internal static partial class SqliteDatabases
{
    internal static ValueTask<PooledDbContextFactory<ExecutionDbContext>>
        CreateSqliteExecutionDbContextFactory(
        DatabaseFilePath databasePath,
        DatabasePoolSize poolSize,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        SQLitePCL.Batteries_V2.Init();

        var options = new DbContextOptionsBuilder<ExecutionDbContext>()
            .UseSqlite(CreateSqliteConnectionString(databasePath))
            .EnableDetailedErrors(false)
            .EnableSensitiveDataLogging(false)
            .Options;

        return ValueTask.FromResult(
            new PooledDbContextFactory<ExecutionDbContext>(options, poolSize.Value));
    }
}
