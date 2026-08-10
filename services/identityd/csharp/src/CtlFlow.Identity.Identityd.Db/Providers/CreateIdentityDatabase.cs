using CtlFlow.Identity.Identityd.Db.Sqlite;
using static CtlFlow.Identity.Identityd.Db.Sqlite.SqliteDatabases;

namespace CtlFlow.Identity.Identityd.Db.Providers;

public static partial class IdentityDatabaseProviders
{
    public static async ValueTask<IdentityDatabase> CreateIdentityDatabase(
        DatabaseConfiguration configuration,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return configuration switch
        {
            DatabaseConfiguration.Sqlite sqlite => new IdentityDatabase(
                await CreateSqliteIdentityDbContextFactory(
                    sqlite.Path,
                    sqlite.PoolSize,
                    cancellation),
                SqliteIdentityMutations.AcquireIdentityMutation),
            _ => throw new InvalidOperationException(
                "Database provider is not implemented")
        };
    }
}
