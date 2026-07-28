using CtlFlow.Packages.Pkgd.Db.Sqlite;
using static CtlFlow.Packages.Pkgd.Db.Sqlite.SqliteDatabases;

namespace CtlFlow.Packages.Pkgd.Db.Providers;

public static partial class PackageDatabaseProviders
{
    public static async ValueTask<PackageDatabase> CreatePackageDatabase(
        DatabaseConfiguration configuration,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return configuration switch
        {
            DatabaseConfiguration.Sqlite sqlite => new PackageDatabase(
                await CreateSqlitePackageDbContextFactory(
                    sqlite.Path,
                    sqlite.PoolSize,
                    cancellation),
                SqlitePackageMutations.AcquirePackageMutation),
            _ => throw new InvalidOperationException(
                "Database provider is not implemented")
        };
    }
}
