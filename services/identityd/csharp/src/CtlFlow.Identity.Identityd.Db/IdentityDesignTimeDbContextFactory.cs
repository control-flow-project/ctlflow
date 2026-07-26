using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace CtlFlow.Identity.Identityd.Db;

public sealed class IdentityDesignTimeDbContextFactory
    : IDesignTimeDbContextFactory<IdentityDbContext>
{
    public IdentityDbContext CreateDbContext(string[] args)
    {
        var databasePath = Path.Combine(
            Path.GetTempPath(),
            "ctlflow-identityd-design.db");
        var connection = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Private,
            ForeignKeys = true,
            Pooling = false
        };
        var options = new DbContextOptionsBuilder<IdentityDbContext>()
            .UseSqlite(connection.ToString())
            .Options;

        return new IdentityDbContext(options);
    }
}
