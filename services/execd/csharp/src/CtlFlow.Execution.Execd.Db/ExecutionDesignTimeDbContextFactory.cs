using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace CtlFlow.Execution.Execd.Db;

public sealed class ExecutionDesignTimeDbContextFactory
    : IDesignTimeDbContextFactory<ExecutionDbContext>
{
    public ExecutionDbContext CreateDbContext(string[] args)
    {
        var databasePath = Path.Combine(
            Path.GetTempPath(),
            "ctlflow-execd-design.db");
        var connection = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Private,
            ForeignKeys = true,
            Pooling = false
        };
        var options = new DbContextOptionsBuilder<ExecutionDbContext>()
            .UseSqlite(connection.ToString())
            .Options;

        return new ExecutionDbContext(options);
    }
}
