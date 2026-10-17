using System.Buffers;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Microsoft.Win32.SafeHandles;

namespace Crossfire.AdapterFilesystem;

public sealed record NativeFileBoundary(string Key, long Position, string Prefix);
public sealed record NativeHistoryInspection(long BytesRead, long Records, int MaximumBufferedBytes);

public static class NativeHistory
{
    public const int MaximumInterval = 8388608;
    public const int MaximumRecord = 33554432;
    private const int ChunkBytes = 65536;

    private static SafeFileHandle Open(string home, string path)
    {
        PrivateFiles.ExistingDirectory(home, true);
        if (!Path.IsPathFullyQualified(path) || Path.GetFullPath(path) != path || !path.StartsWith(home + "/", StringComparison.Ordinal))
            throw new IOException("Native history must use its exact path inside the private managed home");
        using var parent = PrivateFiles.OpenDirectory(Path.GetDirectoryName(path)!, false, false);
        var handle = Posix.Handle(Posix.OpenAt(Posix.Descriptor(parent), Path.GetFileName(path), Posix.ReadOnly | Posix.NoFollow | Posix.NonBlock | Posix.CloseOnExec, 0));
        try
        {
            var metadata = Posix.RegularFile(handle);
            if (metadata.Owner != Posix.Owner() || (metadata.Mode & 2) != 0 || metadata.Size > long.MaxValue)
                throw new IOException("Native history must be an owned regular file without public write access");
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }
    private static string Key(FileMetadata metadata)
    {
        var device = ((ulong)(metadata.DeviceMajor & 0xfff) << 8) | ((ulong)(metadata.DeviceMajor & 0xfffff000) << 32)
            | (metadata.DeviceMinor & 0xfful) | ((ulong)(metadata.DeviceMinor & 0xffffff00) << 12);
        return device.ToString(CultureInfo.InvariantCulture) + ":" + metadata.Inode.ToString(CultureInfo.InvariantCulture);
    }
    private static void ReadExactly(SafeFileHandle handle, Span<byte> bytes, long position)
    {
        var read = 0;
        while (read < bytes.Length)
        {
            var count = RandomAccess.Read(handle, bytes[read..], position + read);
            if (count == 0) throw new IOException("Native history changed during its bounded read at byte " + (position + read) + " of " + RandomAccess.GetLength(handle) + "; requested " + bytes.Length); read += count;
        }
    }
    private static string Prefix(SafeFileHandle handle, long position)
    {
        Span<byte> bytes = stackalloc byte[(int)Math.Min(position, 256)]; ReadExactly(handle, bytes, 0);
        return Convert.ToHexStringLower(SHA256.HashData(bytes));
    }
    private static JsonElement Parse(ReadOnlyMemory<byte> bytes)
    { var value = WireJson.Parse(bytes); if (!Validation.Json(value)) throw new JsonException("Invalid native Unicode JSON"); return value; }
    public static long Length(string home, string path)
    { using var handle = Open(home, path); return checked((long)Posix.Metadata(handle).Size); }
    public static void MakePrivateAndFlush(string home, string path)
    {
        using var handle = Open(home, path);
        if (Posix.Chmod(Posix.Descriptor(handle), 0x180) != 0 || Posix.Sync(Posix.Descriptor(handle)) != 0) throw Posix.Failure();
    }

    public static JsonElement? Header(string home, string path)
    {
        try
        {
            using var handle = Open(home, path); var length = checked((long)Posix.Metadata(handle).Size); var bytes = new ArrayBufferWriter<byte>();
            while (bytes.WrittenCount < length && bytes.WrittenCount < MaximumInterval)
            {
                var count = (int)Math.Min(4096, Math.Min(length - bytes.WrittenCount, MaximumInterval - bytes.WrittenCount));
                var target = bytes.GetSpan(count)[..count]; ReadExactly(handle, target, bytes.WrittenCount); var newline = target.IndexOf((byte)10);
                bytes.Advance(newline < 0 ? count : newline); if (newline >= 0) return Parse(bytes.WrittenMemory);
            }
            if (bytes.WrittenCount == MaximumInterval && length > MaximumInterval) throw new IOException("Native history header exceeds its verification bound");
            return null;
        }
        catch (FileNotFoundException) { return null; }
    }
    public static NativeFileBoundary? Capture(string home, string path)
    {
        try
        {
            using var handle = Open(home, path); var metadata = Posix.Metadata(handle); var position = checked((long)metadata.Size);
            if (position != 0)
            {
                Span<byte> last = stackalloc byte[1]; ReadExactly(handle, last, position - 1);
                if (last[0] != 10)
                {
                    var start = Math.Max(0, position - MaximumInterval); var tail = ArrayPool<byte>.Shared.Rent(checked((int)(position - start)));
                    try
                    {
                        var bytes = tail.AsSpan(0, checked((int)(position - start))); ReadExactly(handle, bytes, start); var newline = bytes.LastIndexOf((byte)10);
                        if (newline < 0 && start != 0) throw new IOException("Partial native history record exceeds its verification bound"); position = start + newline + 1;
                    }
                    finally { ArrayPool<byte>.Shared.Return(tail); }
                }
            }
            return new(Key(metadata), position, Prefix(handle, position));
        }
        catch (FileNotFoundException) { return null; }
    }
    public static NativeHistoryInspection Since(string home, string path, NativeFileBoundary? boundary, Action<JsonElement> inspect)
    {
        try
        {
            using var handle = Open(home, path); var metadata = Posix.Metadata(handle); var length = checked((long)metadata.Size);
            if (boundary is not null && (boundary.Position < 0 || Key(metadata) != boundary.Key || length < boundary.Position || Prefix(handle, boundary.Position) != boundary.Prefix))
                throw new IOException("Native history lost its publication boundary");
            var position = boundary?.Position ?? 0; long read = 0, records = 0; var maximum = 0; var line = new ArrayBufferWriter<byte>();
            var chunk = ArrayPool<byte>.Shared.Rent(ChunkBytes);
            try
            {
                while (position < length)
                {
                    var count = (int)Math.Min(ChunkBytes, length - position); var bytes = chunk.AsSpan(0, count); ReadExactly(handle, bytes, position); position += count; read += count;
                    for (var start = 0; start < count;)
                    {
                        var relative = bytes[start..].IndexOf((byte)10); var stop = relative < 0 ? count : start + relative;
                        if ((long)line.WrittenCount + stop - start > MaximumRecord) throw new IOException("Native history record exceeds its verification bound");
                        line.Write(bytes[start..stop]); maximum = Math.Max(maximum, checked(2 * line.WrittenCount + 2 * ChunkBytes));
                        if (relative < 0) break;
                        if (line.WrittenCount != 0) { inspect(Parse(line.WrittenMemory)); records++; } line.Clear(); start = stop + 1;
                    }
                }
                if (Posix.Metadata(handle).Size < metadata.Size || boundary is not null && Prefix(handle, boundary.Position) != boundary.Prefix)
                    throw new IOException("Native history changed during receipt verification");
                return new(read, records, maximum);
            }
            finally { ArrayPool<byte>.Shared.Return(chunk); }
        }
        catch (FileNotFoundException) when (boundary is null) { return new(0, 0, 0); }
    }
}
