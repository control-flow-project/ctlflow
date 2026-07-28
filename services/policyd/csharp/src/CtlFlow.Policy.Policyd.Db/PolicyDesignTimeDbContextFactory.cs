using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace CtlFlow.Policy.Policyd.Db;

public sealed class PolicyDesignTimeDbContextFactory
    : IDesignTimeDbContextFactory<PolicyDbContext>
{
    public PolicyDbContext CreateDbContext(string[] args)
    {
        _ = args;
        var connection = new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(
                Path.GetTempPath(),
                "ctlflow-policyd-design.db"),
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Private,
            ForeignKeys = true,
            Pooling = false
        };
        var options = new DbContextOptionsBuilder<PolicyDbContext>()
            .UseSqlite(connection.ToString())
            .Options;
        return new PolicyDbContext(options);
    }
}
