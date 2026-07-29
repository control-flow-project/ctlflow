using CtlFlow.Execution.Execd.Db.Sqlite;
using static CtlFlow.Execution.Execd.Db.Sqlite.SqliteDatabases;

namespace CtlFlow.Execution.Execd.Db.Providers;

public static partial class ExecutionDatabaseProviders
{
    public static async ValueTask<ExecutionDatabase> CreateExecutionDatabase(
        DatabaseConfiguration configuration,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return configuration switch
        {
            DatabaseConfiguration.Sqlite sqlite => new ExecutionDatabase(
                await CreateSqliteExecutionDbContextFactory(
                    sqlite.Path,
                    sqlite.PoolSize,
                    cancellation),
                SqliteExecutionMutations.AcquireExecutionMutation),
            _ => throw new InvalidOperationException(
                "Database provider is not implemented")
        };
    }
}
