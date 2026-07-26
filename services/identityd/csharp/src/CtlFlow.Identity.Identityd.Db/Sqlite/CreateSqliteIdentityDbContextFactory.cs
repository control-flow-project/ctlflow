using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using static CtlFlow.Identity.Identityd.Db.Sqlite.SqliteDatabases;

namespace CtlFlow.Identity.Identityd.Db.Sqlite;

internal static partial class SqliteDatabases
{
    internal static ValueTask<PooledDbContextFactory<IdentityDbContext>>
        CreateSqliteIdentityDbContextFactory(
        DatabaseFilePath databasePath,
        DatabasePoolSize poolSize,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        SQLitePCL.Batteries_V2.Init();

        var options = new DbContextOptionsBuilder<IdentityDbContext>()
            .UseSqlite(CreateSqliteConnectionString(databasePath))
            .EnableDetailedErrors(false)
            .EnableSensitiveDataLogging(false)
            .Options;

        return ValueTask.FromResult(
            new PooledDbContextFactory<IdentityDbContext>(
                options,
                poolSize.Value));
    }
}
