using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Crossfire.AdapterFilesystem;

public static class PrivateFiles
{
    public static string Directory(string path)
    {
        using var directory = OpenDirectory(path, create: true, makePrivate: true);
        return Path.GetFullPath(path);
    }

    private static SafeFileHandle OpenDirectory(string path, bool create, bool makePrivate)
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("Private native state requires Linux");
        var full = Path.GetFullPath(path);
        if (full == "/") throw new IOException("Private state cannot replace the filesystem root");
        var handle = Posix.Handle(Posix.Open("/", Posix.ReadOnly | Posix.Directory | Posix.NoFollow | Posix.CloseOnExec, 0));
        try
        {
            foreach (var component in full.Split('/', StringSplitOptions.RemoveEmptyEntries))
            {
                var descriptor = Posix.OpenAt(Posix.Descriptor(handle), component, Posix.ReadOnly | Posix.Directory | Posix.NoFollow | Posix.CloseOnExec, 0);
                if (descriptor < 0 && Marshal.GetLastPInvokeError() == 2 && create)
                {
                    if (Posix.MakeDirectoryAt(Posix.Descriptor(handle), component, 0x1c0) != 0 && Marshal.GetLastPInvokeError() != 17) throw Posix.Failure();
                    descriptor = Posix.OpenAt(Posix.Descriptor(handle), component, Posix.ReadOnly | Posix.Directory | Posix.NoFollow | Posix.CloseOnExec, 0);
                }
                var next = Posix.Handle(descriptor);
                handle.Dispose(); handle = next;
            }
            if (makePrivate)
            {
                var metadata = Posix.Metadata(handle);
                if ((metadata.Mode & 0xf000) != 0x4000 || metadata.Owner != Posix.Owner())
                    throw new IOException("Private state must be an owned, non-symlink directory");
                if (Posix.Chmod(Posix.Descriptor(handle), 0x1c0) != 0) throw Posix.Failure();
            }
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }

    public static string Database(string path)
    {
        if (path == ":memory:") return path;
        var full = Path.GetFullPath(path);
        using var directory = OpenDirectory(Path.GetDirectoryName(full)!, create: true, makePrivate: true);
        using var handle = Posix.Handle(Posix.OpenAt(Posix.Descriptor(directory), Path.GetFileName(full),
            Posix.ReadWrite | Posix.Create | Posix.NoFollow | Posix.NonBlock | Posix.CloseOnExec, 0x180));
        var metadata = Posix.Metadata(handle);
        if ((metadata.Mode & 0xf000) != 0x8000 || metadata.Owner != Posix.Owner() || (metadata.Mode & 0x3f) != 0)
            throw new IOException("Management storage must be a private, owned regular file");
        return full;
    }

    public static byte[] Read(string path, int maximumBytes)
    {
        if (maximumBytes < 1) throw new ArgumentOutOfRangeException(nameof(maximumBytes));
        var full = Path.GetFullPath(path);
        using var directory = OpenDirectory(Path.GetDirectoryName(full)!, create: false, makePrivate: false);
        using var handle = Posix.Handle(Posix.OpenAt(Posix.Descriptor(directory), Path.GetFileName(full),
            Posix.ReadOnly | Posix.NoFollow | Posix.NonBlock | Posix.CloseOnExec, 0));
        var before = Posix.Metadata(handle);
        if ((before.Mode & 0xf000) != 0x8000 || before.Owner != Posix.Owner() || before.Size > (ulong)maximumBytes || (before.Mode & 0x3f) != 0)
            throw new IOException("State must be a private, bounded, owned regular file");
        var expected = checked((int)before.Size);
        var bytes = new byte[checked(expected + 1)];
        var size = 0;
        for (;;)
        {
            var count = RandomAccess.Read(handle, bytes.AsSpan(size), size);
            size += count;
            if (size > expected) throw new IOException("Private state changed during its bounded read");
            if (count == 0) break;
        }
        if (size != expected || Posix.Metadata(handle).Size != before.Size) throw new IOException("Private state changed during its bounded read");
        Array.Resize(ref bytes, expected);
        return bytes;
    }

    public static void Write(string path, ReadOnlySpan<byte> bytes, int maximumBytes)
    {
        if (maximumBytes < 1 || bytes.Length > maximumBytes) throw new IOException("State exceeds its finite byte limit");
        var full = Path.GetFullPath(path);
        using var directory = OpenDirectory(Path.GetDirectoryName(full)!, create: true, makePrivate: true);
        var descriptor = Posix.Descriptor(directory);
        var existing = Posix.OpenAt(descriptor, Path.GetFileName(full), Posix.ReadOnly | Posix.NoFollow | Posix.NonBlock | Posix.CloseOnExec, 0);
        if (existing >= 0)
        {
            using var handle = Posix.Handle(existing);
            var metadata = Posix.Metadata(handle);
            if ((metadata.Mode & 0xf000) != 0x8000 || metadata.Owner != Posix.Owner() || (metadata.Mode & 0x3f) != 0 || metadata.Size > (ulong)maximumBytes)
                throw new IOException("State must be a private, bounded, owned regular file");
        }
        else if (Marshal.GetLastPInvokeError() != 2) throw Posix.Failure();
        var temporary = ".pending-" + Guid.NewGuid().ToString("D");
        try
        {
            using (var handle = Posix.Handle(Posix.OpenAt(descriptor, temporary,
                Posix.ReadWrite | Posix.Create | Posix.Exclusive | Posix.NoFollow | Posix.CloseOnExec, 0x180)))
            { RandomAccess.Write(handle, bytes, 0); RandomAccess.FlushToDisk(handle); }
            if (Posix.RenameAt(descriptor, temporary, descriptor, Path.GetFileName(full)) != 0) throw Posix.Failure();
            if (Posix.Sync(descriptor) != 0) throw Posix.Failure();
        }
        finally
        {
            if (Posix.UnlinkAt(descriptor, temporary, 0) != 0 && Marshal.GetLastPInvokeError() != 2) throw Posix.Failure();
        }
    }
}
