using System.Buffers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterFilesystem;

public sealed class PublicationStore : PublicationStorage
{
    private readonly string root;
    private readonly IDisposable lease;
    private readonly int maximumUploads;
    private readonly HashSet<string> busy = new(StringComparer.Ordinal);
    private readonly object gate = new();
    private int uploads;
    private bool disposed;

    public PublicationStore(string path, int maximumUploads, Func<string, IDisposable> acquire)
    {
        if (maximumUploads is < 1 or > 32) throw new ArgumentOutOfRangeException(nameof(maximumUploads));
        root = PrivateFiles.Directory(path); this.maximumUploads = maximumUploads; lease = acquire(Path.Combine(root, "owner"));
    }
    private static bool Identifier(string value) => value.Length == 36 && Guid.TryParseExact(value, "D", out _) && value.All(character => character is >= 'a' and <= 'f' or >= '0' and <= '9' or '-');
    private string Location(string id)
    {
        if (!Identifier(id)) throw new IOException("Invalid report storage identity");
        using var directory = PrivateFiles.PrivateDirectory(root); return Path.Combine(root, id);
    }
    private static void Sync(string path) { using var directory = PrivateFiles.PrivateDirectory(path); if (Posix.Sync(Posix.Descriptor(directory)) != 0) throw Posix.Failure(); }
    private static string[] Entries(string path)
    {
        using var directory = PrivateFiles.PrivateDirectory(path);
        var entries = System.IO.Directory.EnumerateFileSystemEntries("/proc/self/fd/" + Posix.Descriptor(directory)).Take(514).Select(Path.GetFileName).OfType<string>().ToArray();
        if (entries.Length > 513) throw new IOException("Report storage contains unexpected files"); return entries;
    }
    private static void DiscardPending(string path)
    {
        using var directory = PrivateFiles.PrivateDirectory(path);
        foreach (var name in Entries(path)) if (name.StartsWith(".pending-", StringComparison.Ordinal) && Identifier(name[9..]))
            if (Posix.UnlinkAt(Posix.Descriptor(directory), name, 0) != 0 && Marshal.GetLastPInvokeError() != 2) throw Posix.Failure();
    }
    public async ValueTask<Result<T>> Exclusive<T>(string id, Func<ValueTask<Result<T>>> operation)
    {
        lock (gate)
        {
            if (disposed) return Results.Fail<T>("unavailable", "Report storage is closed");
            if (!busy.Add(id)) return Results.Fail<T>("conflict", "Another report operation is in progress; retry this exact operation");
        }
        try { return await operation(); } finally { lock (gate) busy.Remove(id); }
    }
    public async ValueTask<Result<Unit>> Upload(string id, PublicationFile file, Stream input, CancellationToken cancellation)
    {
        lock (gate) { if (disposed || uploads >= maximumUploads) return Results.Fail<Unit>("rate_limit", "Report upload capacity is busy; retry this exact file"); uploads++; }
        var buffer = ArrayPool<byte>.Shared.Rent(65536);
        try
        {
            if (!Identifier(file.Id)) return Results.Fail<Unit>("invalid", "Invalid report file identity");
            var path = PrivateFiles.Directory(Location(id)); DiscardPending(path);
            using var pending = new AtomicFile(Path.Combine(path, file.Id)); using var digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256); long size = 0;
            for (;;)
            {
                var count = await input.ReadAsync(buffer.AsMemory(0, 65536), cancellation); if (count == 0) break;
                size += count; if (size > file.Manifest.Bytes) return Results.Fail<Unit>("body_too_large", "Report upload exceeds its declared size");
                digest.AppendData(buffer.AsSpan(0, count)); await pending.Stream.WriteAsync(buffer.AsMemory(0, count), cancellation);
            }
            cancellation.ThrowIfCancellationRequested();
            if (size != file.Manifest.Bytes || Convert.ToHexStringLower(digest.GetHashAndReset()) != file.Manifest.Sha256) return Results.Fail<Unit>("invalid", "Report upload size or digest mismatch");
            pending.Commit(); return Results.Done();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or OperationCanceledException) { return Results.Fail<Unit>("unavailable", "Report upload failed; no partial file was published"); }
        finally { ArrayPool<byte>.Shared.Return(buffer); lock (gate) uploads--; }
    }
    public Result<Stream> Read(string id, PublicationFile file)
    {
        try
        {
            if (!Identifier(file.Id)) return Results.Fail<Stream>("invalid", "Invalid report file identity");
            var handle = PrivateFiles.OpenPrivate(Path.Combine(Location(id), file.Id));
            try
            {
                if (RandomAccess.GetLength(handle) != file.Manifest.Bytes) throw new IOException("Report file size does not match its manifest");
                return Result<Stream>.Success(new FileStream(handle, FileAccess.Read, 65536));
            }
            catch { handle.Dispose(); throw; }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return Results.Fail<Stream>("unavailable", "Report file is unavailable or failed its storage integrity check"); }
    }
    public async ValueTask<Result<Unit>> Verify(string id, IReadOnlyList<PublicationFile> files, CancellationToken cancellation)
    {
        var buffer = ArrayPool<byte>.Shared.Rent(65536);
        try
        {
            DiscardPending(Location(id));
            foreach (var file in files)
            {
                var opened = Read(id, file); if (!opened.IsSuccess) return Result<Unit>.Fail(opened.Error);
                await using var stream = opened.Value; using var digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256); long size = 0;
                for (;;)
                {
                    var count = await stream.ReadAsync(buffer.AsMemory(0, 65536), cancellation); if (count == 0) break;
                    size += count; if (size > file.Manifest.Bytes) return Results.Fail<Unit>("conflict", "Report bytes no longer match the declared manifest"); digest.AppendData(buffer.AsSpan(0, count));
                }
                if (size != file.Manifest.Bytes || stream.Length != size || Convert.ToHexStringLower(digest.GetHashAndReset()) != file.Manifest.Sha256) return Results.Fail<Unit>("conflict", "Report bytes no longer match the declared manifest");
            }
            Sync(Location(id)); Sync(root); using var parent = PrivateFiles.OpenDirectory(Path.GetDirectoryName(root)!, false, false);
            if (Posix.Sync(Posix.Descriptor(parent)) != 0) throw Posix.Failure(); return Results.Done();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or OperationCanceledException) { return Results.Fail<Unit>("unavailable", "Report verification failed"); }
        finally { ArrayPool<byte>.Shared.Return(buffer); }
    }
    public Result<Unit> Remove(string id)
    {
        try
        {
            var path = Location(id);
            using var rootHandle = PrivateFiles.PrivateDirectory(root);
            var opened = Posix.OpenAt(Posix.Descriptor(rootHandle), id, Posix.ReadOnly | Posix.NoFollow | Posix.Directory | Posix.CloseOnExec, 0);
            if (opened < 0)
            {
                if (Marshal.GetLastPInvokeError() != 2) throw Posix.Failure(); Sync(root); return Results.Done();
            }
            using var directory = Posix.Handle(opened);
            foreach (var name in Entries(path))
            {
                if (!Identifier(name) && !(name.StartsWith(".pending-", StringComparison.Ordinal) && Identifier(name[9..]))) throw new IOException("Unexpected report storage entry");
                if (Posix.UnlinkAt(Posix.Descriptor(directory), name, 0) != 0) throw Posix.Failure();
            }
            if (Posix.UnlinkAt(Posix.Descriptor(rootHandle), id, 0x200) != 0) throw Posix.Failure(); Sync(root); return Results.Done();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return Results.Fail<Unit>("unavailable", "Report storage cleanup remains pending"); }
    }
    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            if (busy.Count != 0 || uploads != 0) throw new InvalidOperationException("Drain report operations before closing storage"); disposed = true;
        }
        lease.Dispose();
    }
}
