using CtlFlow.Audit.Auditd.Db.Sqlite;
using static CtlFlow.Audit.Auditd.Db.Sqlite.SqliteDatabases;

namespace CtlFlow.Audit.Auditd.Db.Providers;

public static partial class AuditDatabaseProviders
{
    public static async ValueTask<AuditDatabase> CreateAuditDatabase(
        DatabaseConfiguration configuration,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return configuration switch
        {
            DatabaseConfiguration.Sqlite sqlite => new AuditDatabase(
                await CreateSqliteAuditDbContextFactory(
                    sqlite.Path,
                    sqlite.PoolSize,
                    cancellation),
                new AuditMutationCoordinator()),
            _ => throw new InvalidOperationException(
                "Database provider is not implemented")
        };
    }
}
