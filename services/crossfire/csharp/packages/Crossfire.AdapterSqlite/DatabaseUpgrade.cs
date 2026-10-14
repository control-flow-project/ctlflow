using System.Globalization;
using Crossfire.AdapterFilesystem;
using Crossfire.Kernel;
using Microsoft.Data.Sqlite;

namespace Crossfire.AdapterSqlite;

public static class DatabaseUpgrade
{
    private static SqliteConnection Open(string file)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = PrivateFiles.Database(file), Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString());
        try { connection.Open(); return connection; } catch { connection.Dispose(); throw; }
    }
    private static long Number(SqliteConnection connection, string command)
    { using var statement = connection.CreateCommand(); statement.CommandText = command; return Convert.ToInt64(statement.ExecuteScalar(), CultureInfo.InvariantCulture); }
    private static void Verify(SqliteConnection connection)
    {
        if (Number(connection, "PRAGMA application_id") != SchemaContract.ApplicationId) throw new IOException("Management backup application identity does not match Crossfire");
        using var integrity = connection.CreateCommand(); integrity.CommandText = "PRAGMA integrity_check"; using (var rows = integrity.ExecuteReader()) if (!rows.Read() || rows.GetString(0) != "ok" || rows.Read()) throw new IOException("Management backup integrity check failed");
        using var foreignKeys = connection.CreateCommand(); foreignKeys.CommandText = "PRAGMA foreign_key_check"; using var violations = foreignKeys.ExecuteReader(); if (violations.Read()) throw new IOException("Management backup preserved relationships failed");
    }
    private static bool Current(SqliteConnection connection)
    {
        if (Number(connection, "PRAGMA user_version") != SchemaContract.Version || Number(connection, "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='knex_migrations'") != 1) return false;
        using var statement = connection.CreateCommand(); statement.CommandText = "SELECT name FROM knex_migrations ORDER BY name"; using var rows = statement.ExecuteReader(); foreach (var migration in SchemaContract.Migrations) if (!rows.Read() || rows.GetString(0) != migration) return false; return !rows.Read();
    }
    public static string? BackupBeforeMigration(string directory)
    {
        var file = Path.Combine(directory, "management.sqlite"); if (!PrivateFiles.Exists(file)) return null; using var source = Open(file); var application = Number(source, "PRAGMA application_id"); var version = Number(source, "PRAGMA user_version");
        if (application == 0 && version == 0)
        {
            if (Number(source, "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('knex_migrations','knex_migrations_lock')") == 0 && (Number(source, "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='knex_migrations'") == 0 || Number(source, "SELECT COUNT(*) FROM knex_migrations") == 0)) return null;
        }
        if (application != SchemaContract.ApplicationId || version is < 13 or > 17) throw new IOException("Unsupported Crossfire schema; only inventoried deployed schemas 13–17 may advance through Knex. No data was changed"); Verify(source); if (Current(source)) return null;
        var parent = PrivateFiles.Directory(Path.Combine(directory, "backups")); var target = Path.Combine(parent, "management-" + Identity.Identifier() + ".sqlite");
        try
        {
            using (PrivateFiles.OpenPrivate(target, true)) { } using (var copy = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = PrivateFiles.Database(target), Mode = SqliteOpenMode.ReadWrite, Pooling = false }.ToString())) { copy.Open(); source.BackupDatabase(copy); Verify(copy); if (Number(copy, "PRAGMA user_version") != version) throw new IOException("Management backup schema identity differs; migration is blocked"); }
            using var checkedCopy = PrivateFiles.OpenPrivate(target); RandomAccess.FlushToDisk(checkedCopy); return target;
        }
        catch { PrivateFiles.DeletePrivate(target); throw; }
    }
}
