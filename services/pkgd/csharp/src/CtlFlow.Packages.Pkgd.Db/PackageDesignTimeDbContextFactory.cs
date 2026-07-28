using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace CtlFlow.Packages.Pkgd.Db;

public sealed class PackageDesignTimeDbContextFactory
    : IDesignTimeDbContextFactory<PackageDbContext>
{
    public PackageDbContext CreateDbContext(string[] args)
    {
        var databasePath = Path.Combine(
            Path.GetTempPath(),
            "ctlflow-pkgd-design.db");
        var connection = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Private,
            ForeignKeys = true,
            Pooling = false
        };
        var options = new DbContextOptionsBuilder<PackageDbContext>()
            .UseSqlite(connection.ToString())
            .Options;

        return new PackageDbContext(options);
    }
}
