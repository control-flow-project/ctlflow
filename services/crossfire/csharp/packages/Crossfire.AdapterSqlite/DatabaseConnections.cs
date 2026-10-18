using Crossfire.AdapterFilesystem;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class DatabaseConnections
{
    public static DbContextOptions<CrossfireDbContext> Options(string database, bool readOnly = false)
    {
        var options = new DbContextOptionsBuilder<CrossfireDbContext>();
        Configure(options, database, readOnly);
        return options.Options;
    }

    public static void Configure(DbContextOptionsBuilder options, string database, bool readOnly = false)
        => options.UseSqlite(new SqliteConnectionStringBuilder
        {
            DataSource = PrivateFiles.Database(database), ForeignKeys = true, DefaultTimeout = 5, Pooling = true,
            Mode = database == ":memory:" ? SqliteOpenMode.Memory : readOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWrite
        }.ToString());
}
