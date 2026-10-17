using Crossfire.AdapterFilesystem;
using Crossfire.Kernel;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class DatabaseUpgrade
{
    private static CrossfireDbContext Open(string file)
    {
        var context = new CrossfireDbContext(file, readOnly: true);
        try { context.Database.OpenConnection(); return context; } catch { context.Dispose(); throw; }
    }
    private static void Verify(CrossfireDbContext context)
    {
        if (Metadata.Application(context) != SchemaContract.ApplicationId) throw new IOException("Management backup application identity does not match Crossfire");
        if (!Metadata.Valid(context)) throw new IOException("Management backup integrity or preserved relationships failed");
    }
    private static bool Current(CrossfireDbContext context) => Metadata.Version(context) == SchemaContract.Version
        && Metadata.HasMigrations(context) && Metadata.Migrations(context).SequenceEqual(SchemaContract.Migrations);
    public static string? BackupBeforeMigration(string directory)
    {
        var file = Path.Combine(directory, "management.sqlite"); if (!PrivateFiles.Exists(file)) return null; using var source = Open(file); var application = Metadata.Application(source); var version = Metadata.Version(source);
        if (application == 0 && version == 0)
        {
            if (Metadata.Empty(source)) return null;
        }
        if (application != SchemaContract.ApplicationId || version < 13 || version > SchemaContract.Version) throw new IOException("Unsupported Crossfire schema; only inventoried deployed schemas 13–18 may advance through Knex. No data was changed"); Verify(source); if (Current(source)) return null;
        var parent = PrivateFiles.Directory(Path.Combine(directory, "backups")); var target = Path.Combine(parent, "management-" + Identity.Identifier() + ".sqlite");
        try
        {
            using (PrivateFiles.OpenPrivate(target, true)) { }
            using (var copy = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = PrivateFiles.Database(target), Mode = SqliteOpenMode.ReadWrite, Pooling = false }.ToString()))
            {
                copy.Open(); ((SqliteConnection)source.Database.GetDbConnection()).BackupDatabase(copy);
            }
            using var restored = Open(target); Verify(restored);
            if (Metadata.Version(restored) != version) throw new IOException("Management backup schema identity differs; migration is blocked");
            using var checkedCopy = PrivateFiles.OpenPrivate(target); RandomAccess.FlushToDisk(checkedCopy); return target;
        }
        catch { PrivateFiles.DeletePrivate(target); throw; }
    }
}
