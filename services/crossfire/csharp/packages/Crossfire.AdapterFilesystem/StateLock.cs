using Microsoft.Data.Sqlite;
using Microsoft.Win32.SafeHandles;

namespace Crossfire.AdapterFilesystem;

public sealed class StateLock : IDisposable
{
    private static readonly HashSet<string> Owners = new(StringComparer.Ordinal);
    private static readonly object Gate = new();
    private readonly SafeFileHandle descriptor;
    private readonly SqliteConnection connection;
    private readonly string file;
    private bool disposed;
    public StateLock(string path)
    {
        file = Path.GetFullPath(path) + ".lock";
        lock (Gate) if (!Owners.Add(file)) throw new IOException("Another process already owns this private state");
        try
        {
            descriptor = PrivateFiles.OpenPrivate(file, create: true);
            try
            {
                connection = new(new SqliteConnectionStringBuilder { DataSource = file, Mode = SqliteOpenMode.ReadWrite, Pooling = false }.ToString());
                try
                {
                    connection.Open(); var native = connection.Handle!;
                    if (SQLitePCL.raw.sqlite3_busy_timeout(native, 0) != 0) throw new IOException("Private lock could not disable native waiting");
                    Require(SQLitePCL.raw.sqlite3_prepare_v2(native, "PRAGMA journal_mode = MEMORY", out var statement), SQLitePCL.raw.SQLITE_OK, "Private lock journal could not be selected");
                    using (statement)
                    {
                        Require(SQLitePCL.raw.sqlite3_step(statement), SQLitePCL.raw.SQLITE_ROW, "Private lock journal could not be selected");
                        if (SQLitePCL.raw.sqlite3_column_text(statement, 0).utf8_to_string() != "memory") throw new IOException("Private lock requires an in-memory rollback journal");
                    }
                    Require(SQLitePCL.raw.sqlite3_exec(native, "BEGIN EXCLUSIVE"), SQLitePCL.raw.SQLITE_OK, "Private ownership lock could not be acquired");
                }
                catch { connection.Dispose(); throw; }
            }
            catch { descriptor.Dispose(); throw; }
        }
        catch { lock (Gate) Owners.Remove(file); throw; }
    }
    private static void Require(int result, int expected, string message)
    {
        if ((result & 0xff) is SQLitePCL.raw.SQLITE_BUSY or SQLitePCL.raw.SQLITE_LOCKED) throw new IOException("Another process already owns this private state");
        if (result != expected) throw new IOException(message);
    }
    public void Dispose() { if (disposed) return; disposed = true; connection.Dispose(); descriptor.Dispose(); lock (Gate) Owners.Remove(file); }
}
