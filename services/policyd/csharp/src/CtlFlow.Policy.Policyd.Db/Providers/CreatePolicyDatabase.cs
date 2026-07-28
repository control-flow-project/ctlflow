using static CtlFlow.Policy.Policyd.Db.Sqlite.SqliteDatabases;

namespace CtlFlow.Policy.Policyd.Db.Providers;

public static partial class PolicyDatabaseProviders
{
    public static async ValueTask<PolicyDatabase> CreatePolicyDatabase(
        DatabaseConfiguration configuration,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return configuration switch
        {
            DatabaseConfiguration.Sqlite sqlite => new PolicyDatabase(
                await CreateSqlitePolicyDbContextFactory(
                    sqlite.Path,
                    sqlite.PoolSize,
                    cancellation)),
            _ => throw new InvalidOperationException(
                "Database provider is not implemented")
        };
    }
}
