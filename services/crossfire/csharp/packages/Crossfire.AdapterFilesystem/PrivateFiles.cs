using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Crossfire.AdapterFilesystem;

public static class PrivateFiles
{
    private enum ReadPolicy { Private, Published, Configuration, NativeEvidence }
    public static string Directory(string path)
    {
        using var directory = OpenDirectory(path, create: true, makePrivate: true);
        return Path.GetFullPath(path);
    }

    public static string ExistingDirectory(string path, bool privateState)
    {
        if (!Path.IsPathFullyQualified(path) || Path.GetFullPath(path) != path) throw new IOException("Use an exact absolute existing directory");
        using var handle = privateState ? PrivateDirectory(path) : OpenDirectory(path, false, false);
        return path;
    }
    public static string OwnedDirectory(string path, bool allowGroupWrite = false)
    {
        if (!Path.IsPathFullyQualified(path) || Path.GetFullPath(path) != path) throw new IOException("Use an exact absolute owned directory");
        using var handle = OpenDirectory(path, false, false); var metadata = Posix.Metadata(handle);
        if (metadata.Owner != Posix.Owner() || (metadata.Mode & (allowGroupWrite ? 0x2 : 0x12)) != 0) throw new IOException("Configuration directories must be owned and not writable by others"); return path;
    }

    public static bool Exists(string path)
    {
        var full = Path.GetFullPath(path);
        try
        {
            using var parent = OpenDirectory(Path.GetDirectoryName(full)!, false, false); Posix.MetadataAt(parent, Path.GetFileName(full)); return true;
        }
        catch (FileNotFoundException) { return false; }
    }

    public static void DeletePrivate(string path)
    {
        var full = Path.GetFullPath(path); using var parent = PrivateDirectory(Path.GetDirectoryName(full)!);
        try { using var file = OpenPrivate(full); }
        catch (FileNotFoundException) { return; }
        if (Posix.UnlinkAt(Posix.Descriptor(parent), Path.GetFileName(full), 0) != 0) throw Posix.Failure();
        if (Posix.Sync(Posix.Descriptor(parent)) != 0) throw Posix.Failure();
    }
    public static void MovePrivate(string source, string destination)
    {
        using var file = OpenPrivate(source); using var original = PrivateDirectory(Path.GetDirectoryName(source)!); using var target = PrivateDirectory(Path.GetDirectoryName(destination)!);
        if (Posix.RenameExclusive(Posix.Descriptor(original), Path.GetFileName(source), Posix.Descriptor(target), Path.GetFileName(destination), 1) != 0 || Posix.Sync(Posix.Descriptor(original)) != 0 || Posix.Sync(Posix.Descriptor(target)) != 0) throw Posix.Failure();
    }

    internal static SafeFileHandle OpenDirectory(string path, bool create, bool makePrivate)
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
        using var directory = OpenDirectory(Path.GetDirectoryName(full)!, create: false, makePrivate: false);
        var parent = Posix.Metadata(directory);
        if (parent.Owner != Posix.Owner() || (parent.Mode & 0x3f) != 0)
            throw new IOException("Management storage must be a private owned non-symlink directory");
        using var handle = Posix.Handle(Posix.OpenAt(Posix.Descriptor(directory), Path.GetFileName(full),
            Posix.ReadWrite | Posix.NoFollow | Posix.NonBlock | Posix.CloseOnExec, 0));
        var metadata = Posix.RegularFile(handle);
        if (metadata.Owner != Posix.Owner() || (metadata.Mode & 0x3f) != 0)
            throw new IOException("Management storage must be a private, owned regular file");
        return full;
    }

    public static SafeFileHandle OpenPrivate(string path, bool create = false)
    {
        var full = Path.GetFullPath(path);
        using var directory = PrivateDirectory(Path.GetDirectoryName(full)!);
        var handle = Posix.Handle(Posix.OpenAt(Posix.Descriptor(directory), Path.GetFileName(full), (create ? Posix.Create | Posix.ReadWrite : Posix.ReadOnly) | Posix.NoFollow | Posix.NonBlock | Posix.CloseOnExec, 0x180));
        try
        {
            var metadata = Posix.RegularFile(handle);
            if (metadata.Owner != Posix.Owner() || (metadata.Mode & 0x3f) != 0 || metadata.Links != 1) throw new IOException("Private storage must be an owned, single-link regular file");
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }

    public static string UnixSocket(string path)
    {
        if (!Path.IsPathFullyQualified(path) || path != Path.GetFullPath(path)) throw new IOException("Native socket requires an exact absolute path");
        using var parent = PrivateDirectory(Path.GetDirectoryName(path)!); var metadata = Posix.MetadataAt(parent, Path.GetFileName(path));
        if ((metadata.Mode & 0xf000) != 0xc000 || metadata.Owner != Posix.Owner() || (metadata.Mode & 0x3f) != 0) throw new IOException("Native socket must be private and owned");
        return path;
    }

    public static string Executable(string path)
    {
        if (!Path.IsPathFullyQualified(path) || path != Path.GetFullPath(path)) throw new IOException("Executable requires an exact absolute path");
        using var directory = OpenDirectory(Path.GetDirectoryName(path)!, false, false);
        using var file = Posix.Handle(Posix.OpenAt(Posix.Descriptor(directory), Path.GetFileName(path), Posix.ReadOnly | Posix.NoFollow | Posix.NonBlock | Posix.CloseOnExec, 0));
        var metadata = Posix.RegularFile(file);
        if (metadata.Owner != Posix.Owner() || (metadata.Mode & 0x12) != 0 || (metadata.Mode & 0x40) == 0) throw new IOException("Installed executable must be owned, executable and not writable by others");
        return path;
    }

    internal static SafeFileHandle PrivateDirectory(string path)
    {
        var handle = OpenDirectory(path, false, false);
        var metadata = Posix.Metadata(handle);
        if (metadata.Owner == Posix.Owner() && (metadata.Mode & 0x3f) == 0) return handle;
        handle.Dispose(); throw new IOException("Private storage directory is not private and owned");
    }

    public static byte[] Read(string path, int maximumBytes)
        => ReadBounded(path, maximumBytes, ReadPolicy.Private);

    public static byte[] ReadPublished(string path, int maximumBytes)
        => ReadBounded(path, maximumBytes, ReadPolicy.Published);

    public static byte[] ReadConfiguration(string path, int maximumBytes)
        => ReadBounded(path, maximumBytes, ReadPolicy.Configuration);

    public static byte[] ReadNativeEvidence(string privateRoot, string relative, int maximumBytes)
    {
        ExistingDirectory(privateRoot, true);
        if (Path.IsPathFullyQualified(relative)) throw new IOException("Native evidence must be relative to its private managed home");
        var path = Path.GetFullPath(Path.Combine(privateRoot, relative));
        if (!path.StartsWith(privateRoot + "/", StringComparison.Ordinal)) throw new IOException("Native evidence cannot escape its managed home");
        return ReadBounded(path, maximumBytes, ReadPolicy.NativeEvidence);
    }

    private static byte[] ReadBounded(string path, int maximumBytes, ReadPolicy policy)
    {
        if (maximumBytes < 1) throw new ArgumentOutOfRangeException(nameof(maximumBytes));
        var full = Path.GetFullPath(path);
        using var directory = OpenDirectory(Path.GetDirectoryName(full)!, create: false, makePrivate: false);
        using var handle = Posix.Handle(Posix.OpenAt(Posix.Descriptor(directory), Path.GetFileName(full),
            Posix.ReadOnly | Posix.NoFollow | Posix.NonBlock | Posix.CloseOnExec, 0));
        var before = Posix.RegularFile(handle);
        var unsafeAccess = policy switch
        {
            ReadPolicy.Private => before.Owner != Posix.Owner() || (before.Mode & 0x3f) != 0 || before.Links != 1,
            ReadPolicy.Configuration => before.Owner != Posix.Owner() || (before.Mode & 0x12) != 0,
            ReadPolicy.NativeEvidence => before.Owner != Posix.Owner() || (before.Mode & 0x2) != 0,
            _ => false
        };
        if (before.Size > (ulong)maximumBytes || unsafeAccess)
            throw new IOException("The selected native file does not meet its ownership, access and finite-size contract");
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
        var after = Posix.Metadata(handle);
        if (size != expected || after.Size != before.Size || after.ModifiedSeconds != before.ModifiedSeconds || after.ModifiedNanos != before.ModifiedNanos) throw new IOException("Private state changed during its bounded read");
        Array.Resize(ref bytes, expected);
        return bytes;
    }

    public static void Write(string path, ReadOnlySpan<byte> bytes, int maximumBytes)
        => WriteCore(path, bytes, maximumBytes, true);
    public static void WriteConfiguration(string path, ReadOnlySpan<byte> bytes, int maximumBytes)
        => WriteCore(path, bytes, maximumBytes, false);
    private static void WriteCore(string path, ReadOnlySpan<byte> bytes, int maximumBytes, bool privateState)
    {
        if (maximumBytes < 1 || bytes.Length > maximumBytes) throw new IOException("State exceeds its finite byte limit");
        var full = Path.GetFullPath(path);
        if (!privateState) OwnedDirectory(Path.GetDirectoryName(full)!);
        using var directory = OpenDirectory(Path.GetDirectoryName(full)!, create: privateState, makePrivate: privateState);
        var descriptor = Posix.Descriptor(directory);
        var existing = Posix.OpenAt(descriptor, Path.GetFileName(full), Posix.ReadOnly | Posix.NoFollow | Posix.NonBlock | Posix.CloseOnExec, 0);
        if (existing >= 0)
        {
            using var handle = Posix.Handle(existing);
            var metadata = Posix.Metadata(handle);
            if ((metadata.Mode & 0xf000) != 0x8000 || metadata.Owner != Posix.Owner() || (metadata.Mode & (privateState ? 0x3f : 0x12)) != 0 || metadata.Size > (ulong)maximumBytes)
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
