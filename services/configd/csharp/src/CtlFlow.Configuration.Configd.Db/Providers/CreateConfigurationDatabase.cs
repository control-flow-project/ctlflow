using CtlFlow.Configuration.Configd.Db.Sqlite;
using static CtlFlow.Configuration.Configd.Db.Sqlite.SqliteDatabases;

namespace CtlFlow.Configuration.Configd.Db.Providers;

public static partial class ConfigurationDatabaseProviders
{
    public static async ValueTask<ConfigurationDatabase> CreateConfigurationDatabase(
        DatabaseConfiguration configuration,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return configuration switch
        {
            DatabaseConfiguration.Sqlite sqlite => new ConfigurationDatabase(
                await CreateSqliteConfigurationDbContextFactory(
                    sqlite.Path,
                    sqlite.PoolSize,
                    cancellation),
                SqliteConfigurationMutations.AcquireConfigurationMutation),
            _ => throw new InvalidOperationException(
                "Database provider is not implemented")
        };
    }
}
