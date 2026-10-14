using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Crossfire.AdapterFilesystem;

[StructLayout(LayoutKind.Explicit, Size = 256)]
internal struct FileMetadata
{
    [FieldOffset(0)] public uint Mask;
    [FieldOffset(20)] public uint Owner;
    [FieldOffset(28)] public ushort Mode;
    [FieldOffset(40)] public ulong Size;
}

internal static partial class Posix
{
    internal const int ReadOnly = 0;
    internal const int ReadWrite = 2;
    internal const int Create = 0x40;
    internal const int Exclusive = 0x80;
    internal const int NonBlock = 0x800;
    internal const int Directory = 0x10000;
    internal const int NoFollow = 0x20000;
    internal const int CloseOnExec = 0x80000;

    [LibraryImport("libc", EntryPoint = "open", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    internal static partial int Open(string path, int flags, uint mode);
    [LibraryImport("libc", EntryPoint = "openat", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    internal static partial int OpenAt(int directory, string path, int flags, uint mode);
    [LibraryImport("libc", EntryPoint = "mkdirat", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    internal static partial int MakeDirectoryAt(int directory, string path, uint mode);
    [LibraryImport("libc", EntryPoint = "statx", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    private static partial int Stat(int descriptor, string path, int flags, uint mask, out FileMetadata metadata);
    [LibraryImport("libc", EntryPoint = "geteuid")]
    internal static partial uint Owner();
    [LibraryImport("libc", EntryPoint = "fchmod", SetLastError = true)]
    internal static partial int Chmod(int descriptor, uint mode);
    [LibraryImport("libc", EntryPoint = "fsync", SetLastError = true)]
    internal static partial int Sync(int descriptor);
    [LibraryImport("libc", EntryPoint = "renameat", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    internal static partial int RenameAt(int directory, string oldName, int newDirectory, string newName);
    [LibraryImport("libc", EntryPoint = "unlinkat", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    internal static partial int UnlinkAt(int directory, string path, int flags);

    internal static SafeFileHandle Handle(int descriptor)
        => descriptor >= 0 ? new(new IntPtr(descriptor), ownsHandle: true) : throw Failure();
    internal static int Descriptor(SafeFileHandle handle) => handle.DangerousGetHandle().ToInt32();
    internal static IOException Failure() => new("Private native filesystem operation failed (errno " + Marshal.GetLastPInvokeError() + ")");

    internal static FileMetadata Metadata(SafeFileHandle handle)
    {
        if (Stat(Descriptor(handle), "", 0x1000, 0x20b, out var metadata) != 0) throw Failure();
        if ((metadata.Mask & 0x20b) != 0x20b) throw new IOException("Private filesystem metadata is incomplete");
        return metadata;
    }
}
