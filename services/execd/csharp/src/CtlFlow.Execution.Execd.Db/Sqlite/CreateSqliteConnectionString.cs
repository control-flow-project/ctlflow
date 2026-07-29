using Microsoft.Data.Sqlite;

namespace CtlFlow.Execution.Execd.Db.Sqlite;

internal static partial class SqliteDatabases
{
    internal static string CreateSqliteConnectionString(DatabaseFilePath databasePath)
    {
        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath.Value,
            Mode = SqliteOpenMode.ReadWrite,
            Cache = SqliteCacheMode.Private,
            ForeignKeys = true,
            Pooling = true
        };

        return builder.ToString();
    }
}
