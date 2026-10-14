using System.Buffers;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using Crossfire.Kernel;

namespace Crossfire.AdapterFilesystem;

public sealed partial class DiagnosticStore
{
    public static async ValueTask<Result<Unit>> Migrate(string file, string directory, long days, Func<long> now)
    {
        if (days is < 1 or > 104249991) return Results.Fail<Unit>("invalid", "Invalid diagnostic retention days"); string? temporary = null;
        try
        {
            if (!PrivateFiles.Exists(file)) return Results.Done(); PrivateFiles.Directory(directory); using var input = PrivateFiles.OpenPrivate(file); var before = Posix.Metadata(input);
            var modified = before.ModifiedSeconds * 1000d + before.ModifiedNanos / 1000000d; var at = (long)Math.Floor(modified); if (at < 0) return Results.Fail<Unit>("invalid", "Invalid deployed diagnostic timestamp");
            if (at < checked(now() - days * 86400000)) { Unchanged(file, input, before); PrivateFiles.DeletePrivate(file); return Results.Done(); }
            var device = ((ulong)before.DeviceMinor & 0xff) | (((ulong)before.DeviceMajor & 0xfff) << 8) | (((ulong)before.DeviceMinor & ~0xffUL) << 12) | (((ulong)before.DeviceMajor & ~0xfffUL) << 32);
            var identity = Identity.Hash(WireJson.Compact(WireJson.Array(writer => { writer.WriteNumberValue(device); writer.WriteNumberValue(before.Inode); writer.WriteNumberValue(before.Size); writer.WriteNumberValue(modified); })));
            var name = DateTimeOffset.FromUnixTimeMilliseconds(at).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "-" + identity + ".jsonl"; var target = Path.Combine(directory, name);
            if (!PrivateFiles.Exists(target))
            {
                using var parent = PrivateFiles.PrivateDirectory(directory); var pending = name + ".pending-" + Identity.Identifier(); temporary = Path.Combine(directory, pending);
                using var output = Posix.Handle(Posix.OpenAt(Posix.Descriptor(parent), pending, Posix.ReadWrite | Posix.Create | Posix.Exclusive | Posix.NoFollow | Posix.CloseOnExec, 0x180));
                var bytes = ArrayPool<byte>.Shared.Rent(65536); var characters = ArrayPool<char>.Shared.Rent(65538); var decoder = new UTF8Encoding(false, true).GetDecoder(); long position = 0, written = 0;
                try
                {
                    for (;;)
                    {
                        var count = RandomAccess.Read(input, bytes.AsSpan(0, 65536), position); position += count; var decoded = decoder.GetChars(bytes.AsSpan(0, count), characters, count == 0);
                        if (decoded != 0)
                        {
                            var message = new string(characters, 0, decoded); var record = WireJson.Bytes(WireJson.Object(writer => { writer.WriteNumber("at", at); writer.WriteString("message", message); writer.WriteString("timeBasis", "file-modification-upper-bound"); })); if (record.Length > 524288) throw new IOException("Diagnostic conversion record exceeds its byte bound");
                            RandomAccess.Write(output, record, written); written += record.Length; RandomAccess.Write(output, "\n"u8, written++);
                        }
                        if (count == 0) break; await Task.Yield();
                    }
                    Unchanged(file, input, before); RandomAccess.FlushToDisk(output); if (Posix.RenameExclusive(Posix.Descriptor(parent), pending, Posix.Descriptor(parent), name, 1) != 0 || Posix.Sync(Posix.Descriptor(parent)) != 0) throw Posix.Failure(); temporary = null;
                }
                finally { ArrayPool<byte>.Shared.Return(bytes); ArrayPool<char>.Shared.Return(characters); }
            }
            else { using var completed = PrivateFiles.OpenPrivate(target); }
            Unchanged(file, input, before); PrivateFiles.DeletePrivate(file); return Results.Done();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or OverflowException) { return Results.Fail<Unit>("unavailable", "Deployed diagnostic conversion failed; the original log remains available for inspection"); }
        finally { if (temporary is not null && PrivateFiles.Exists(temporary)) PrivateFiles.DeletePrivate(temporary); }
    }
}
