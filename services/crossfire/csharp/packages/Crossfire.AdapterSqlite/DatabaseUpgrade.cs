using Crossfire.AdapterFilesystem;
using Crossfire.Kernel;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class DatabaseUpgrade
{
    private static CrossfireDbContext Open(string file)
    {
        var context = new CrossfireDbContext(DatabaseConnections.Options(file, readOnly: true));
        try { context.Database.OpenConnection(); return context; } catch { context.Dispose(); throw; }
    }
    private static void Verify(CrossfireDbContext context)
    {
        if (Metadata.Application(context) != SchemaContract.ApplicationId) throw new IOException("Management backup application identity does not match Crossfire");
        if (!Metadata.Valid(context)) throw new IOException("Management backup integrity or preserved relationships failed");
    }
    public static string? BackupBeforeMigration(string directory)
    {
        var file = Path.Combine(directory, "management.sqlite");
        if (!PrivateFiles.Exists(file)) return null;
        using var source = Open(file);
        var valid = Schema.Validate(source);
        if (!valid.IsSuccess) throw new IOException(valid.Error.Message);
        Verify(source);
        var version = Metadata.Version(source);
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
