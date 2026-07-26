using CtlFlow.Tenancy.Tenantd.Db.Sqlite;
using static CtlFlow.Tenancy.Tenantd.Db.Sqlite.SqliteDatabases;

namespace CtlFlow.Tenancy.Tenantd.Db.Providers;

public static partial class TenantDatabaseProviders
{
    public static async ValueTask<TenantDatabase> CreateTenantDatabase(
        DatabaseConfiguration configuration,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return configuration switch
        {
            DatabaseConfiguration.Sqlite sqlite => new TenantDatabase(
                await CreateSqliteTenantDbContextFactory(
                    sqlite.Path,
                    sqlite.PoolSize,
                    cancellation),
                SqliteTenantMutations.AcquireTenantMutation),
            _ => throw new InvalidOperationException(
                "Database provider is not implemented")
        };
    }
}
