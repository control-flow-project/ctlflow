using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using static CtlFlow.Packages.Pkgd.Db.Sqlite.SqliteDatabases;

namespace CtlFlow.Packages.Pkgd.Db.Sqlite;

internal static partial class SqliteDatabases
{
    internal static ValueTask<PooledDbContextFactory<PackageDbContext>>
        CreateSqlitePackageDbContextFactory(
        DatabaseFilePath databasePath,
        DatabasePoolSize poolSize,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        SQLitePCL.Batteries_V2.Init();

        var options = new DbContextOptionsBuilder<PackageDbContext>()
            .UseSqlite(CreateSqliteConnectionString(databasePath))
            .EnableDetailedErrors(false)
            .EnableSensitiveDataLogging(false)
            .Options;

        return ValueTask.FromResult(
            new PooledDbContextFactory<PackageDbContext>(options, poolSize.Value));
    }
}
