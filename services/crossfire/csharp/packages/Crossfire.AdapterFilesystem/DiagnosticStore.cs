using System.Buffers;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.Win32.SafeHandles;

namespace Crossfire.AdapterFilesystem;

public sealed partial class DiagnosticStore : PlatformDiagnostics
{
    private readonly string directory;
    private readonly long days;
    private readonly Func<long> now;
    private readonly object gate = new();
    private string? writeError;
    private string? cleanupError;
    private string? maintenanceError;
    private bool closed;
    public DiagnosticStore(string path, long days, Func<long> now)
    {
        if (days is < 1 or > 104249991) throw new ArgumentOutOfRangeException(nameof(days));
        directory = PrivateFiles.Directory(path); this.days = days; this.now = now;
    }
    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}(?:-[a-f0-9]{64})?\.jsonl$", RegexOptions.CultureInvariant)]
    private static partial Regex Partition();
    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}(?:-[a-f0-9]{64})?\.jsonl\.pending-[a-f0-9-]{36}$", RegexOptions.CultureInvariant)]
    private static partial Regex Pending();
    public string? Error { get { lock (gate) return writeError ?? cleanupError ?? maintenanceError; } }
    public void MaintenanceError(string? message) { lock (gate) maintenanceError = message; }
    public void Write(string message)
    {
        lock (gate)
        {
            if (closed) { writeError = "Diagnostic log is closed"; return; }
            try
            {
                var at = now(); if (at < 0) throw new IOException("Invalid diagnostic clock");
                var name = DateTimeOffset.FromUnixTimeMilliseconds(at).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + ".jsonl";
                using var parent = PrivateFiles.PrivateDirectory(directory);
                using var handle = Posix.Handle(Posix.OpenAt(Posix.Descriptor(parent), name, Posix.ReadWrite | Posix.Create | Posix.NoFollow | Posix.NonBlock | Posix.CloseOnExec | 0x400, 0x180));
                Validate(handle);
                using var stream = new FileStream(handle, FileAccess.Write, 65536, isAsync: false);
                var bytes = Encoding.UTF8.GetBytes(message); var decoder = Encoding.UTF8.GetDecoder(); var characters = ArrayPool<char>.Shared.Rent(65538);
                try
                {
                    for (var offset = 0; offset < bytes.Length || offset == 0; offset += 65536)
                    {
                        var length = Math.Min(65536, bytes.Length - offset); var count = decoder.GetChars(bytes.AsSpan(offset, length), characters, offset + length == bytes.Length);
                        var output = new ArrayBufferWriter<byte>();
                        using (var writer = new Utf8JsonWriter(output)) { writer.WriteStartObject(); writer.WriteNumber("at", at); writer.WriteString("message", characters.AsSpan(0, count)); writer.WriteEndObject(); }
                        if (output.WrittenCount > 524288) throw new IOException("Diagnostic record exceeds its byte bound");
                        stream.Write(output.WrittenSpan); stream.WriteByte(10);
                        if (offset + length >= bytes.Length) break;
                    }
                }
                finally { ArrayPool<char>.Shared.Return(characters); }
                stream.Flush();
                writeError = null;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException) { writeError = "Platform diagnostic logging is unavailable; inspect private logging storage"; }
        }
    }
    private static void Validate(SafeFileHandle handle)
    {
        var metadata = Posix.RegularFile(handle);
        if (metadata.Owner != Posix.Owner() || metadata.Links != 1 || (metadata.Mode & 0x3f) != 0) throw new IOException("Diagnostic logs must be private owned single-link regular files");
    }
    private static bool Same(FileMetadata before, FileMetadata current) => before.Inode == current.Inode && before.DeviceMajor == current.DeviceMajor && before.DeviceMinor == current.DeviceMinor
        && before.Size == current.Size && before.ModifiedSeconds == current.ModifiedSeconds && before.ModifiedNanos == current.ModifiedNanos;
    private static void Unchanged(string path, SafeFileHandle opened, FileMetadata before)
    {
        using var current = PrivateFiles.OpenPrivate(path);
        if (!Same(before, Posix.Metadata(opened)) || !Same(before, Posix.Metadata(current))) throw new IOException("Diagnostic log changed during cleanup");
    }
    private void Trim(string path, long cutoff)
    {
        using var input = PrivateFiles.OpenPrivate(path); var before = Posix.Metadata(input);
        using var parent = PrivateFiles.PrivateDirectory(directory); var descriptor = Posix.Descriptor(parent); var pending = Path.GetFileName(path) + ".pending-" + Identity.Identifier();
        try
        {
            using var output = Posix.Handle(Posix.OpenAt(descriptor, pending, Posix.ReadWrite | Posix.Create | Posix.Exclusive | Posix.NoFollow | Posix.CloseOnExec, 0x180));
            var buffer = ArrayPool<byte>.Shared.Rent(65536); var record = new ArrayBufferWriter<byte>(); long position = 0; long written = 0;
            try
            {
                for (;;)
                {
                    var count = RandomAccess.Read(input, buffer.AsSpan(0, 65536), position); position += count; var span = buffer.AsSpan(0, count);
                    while (!span.IsEmpty)
                    {
                        var newline = span.IndexOf((byte)10); var length = newline < 0 ? span.Length : newline;
                        if (record.WrittenCount + length > 524288) throw new IOException("Diagnostic record exceeds its byte bound");
                        record.Write(span[..length]);
                        if (newline < 0) break;
                        using var document = JsonDocument.Parse(record.WrittenMemory);
                        if (document.RootElement.ValueKind != JsonValueKind.Object || !document.RootElement.TryGetProperty("at", out var timestamp) || !timestamp.TryGetInt64(out var at) || at is < -9007199254740991 or > 9007199254740991) throw new IOException("Invalid diagnostic record timestamp");
                        if (at >= cutoff) { RandomAccess.Write(output, record.WrittenSpan, written); written += record.WrittenCount; RandomAccess.Write(output, "\n"u8, written++); }
                        record.Clear(); span = span[(newline + 1)..];
                    }
                    if (count == 0) break;
                }
            }
            finally { ArrayPool<byte>.Shared.Return(buffer); }
            if (record.WrittenCount != 0) throw new IOException("Incomplete diagnostic record; retained for inspection");
            Unchanged(path, input, before); RandomAccess.FlushToDisk(output);
            if (written == 0) { if (Posix.UnlinkAt(descriptor, Path.GetFileName(path), 0) != 0) throw Posix.Failure(); }
            else if (Posix.RenameAt(descriptor, pending, descriptor, Path.GetFileName(path)) != 0) throw Posix.Failure();
            if (Posix.Sync(descriptor) != 0) throw Posix.Failure();
        }
        finally { if (Posix.UnlinkAt(descriptor, pending, 0) != 0 && Marshal.GetLastPInvokeError() != 2) throw Posix.Failure(); }
    }
    public Result<Unit> Prune()
    {
        lock (gate)
        {
            if (closed) return Results.Fail<Unit>("unavailable", "Diagnostic log is closed");
            try
            {
                var cutoff = checked(now() - days * 86400000); using var parent = PrivateFiles.PrivateDirectory(directory); var failed = false;
                foreach (var path in System.IO.Directory.EnumerateFileSystemEntries("/proc/self/fd/" + Posix.Descriptor(parent)))
                {
                    var name = Path.GetFileName(path); var file = Path.Combine(directory, name);
                    try
                    {
                        if (Pending().IsMatch(name))
                        {
                            using var handle = PrivateFiles.OpenPrivate(file); var before = Posix.Metadata(handle);
                            if (before.ModifiedSeconds * 1000 + before.ModifiedNanos / 1000000 < cutoff) { Unchanged(file, handle, before); if (Posix.UnlinkAt(Posix.Descriptor(parent), name, 0) != 0) throw Posix.Failure(); }
                            continue;
                        }
                        if (!Partition().IsMatch(name)) continue;
                        if (!DateTimeOffset.TryParseExact(name[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date)) throw new IOException("Invalid diagnostic partition");
                        var first = date.ToUnixTimeMilliseconds(); if (first >= cutoff) continue;
                        if (first + 86400000 <= cutoff)
                        {
                            using var handle = PrivateFiles.OpenPrivate(file); Unchanged(file, handle, Posix.Metadata(handle));
                            if (Posix.UnlinkAt(Posix.Descriptor(parent), name, 0) != 0) throw Posix.Failure();
                        }
                        else Trim(file, cutoff);
                    }
                    catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException) { failed = true; }
                }
                if (failed) throw new IOException("One or more diagnostic files require inspection"); cleanupError = null; return Results.Done();
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or OverflowException)
            { cleanupError = "Platform diagnostic cleanup is unavailable; retained files require inspection"; return Results.Fail<Unit>("unavailable", cleanupError); }
        }
    }
    public void Dispose() { lock (gate) closed = true; }
}
