using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace CtlFlow.Audit.Auditd.Db;

public sealed class AuditDesignTimeDbContextFactory
    : IDesignTimeDbContextFactory<AuditDbContext>
{
    public AuditDbContext CreateDbContext(string[] args)
    {
        var databasePath = Path.Combine(
            Path.GetTempPath(),
            "ctlflow-auditd-design.db");
        var connection = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Private,
            ForeignKeys = true,
            Pooling = false
        };
        var options = new DbContextOptionsBuilder<AuditDbContext>()
            .UseSqlite(connection.ToString())
            .Options;

        return new AuditDbContext(options);
    }
}
