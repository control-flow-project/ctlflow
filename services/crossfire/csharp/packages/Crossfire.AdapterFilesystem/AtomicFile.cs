using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Crossfire.AdapterFilesystem;

public sealed class AtomicFile : IDisposable
{
    private readonly SafeFileHandle directory;
    private readonly string pending;
    private readonly string name;
    private bool committed;
    private bool disposed;
    public FileStream Stream { get; }

    public AtomicFile(string path)
    {
        var full = Path.GetFullPath(path); directory = PrivateFiles.PrivateDirectory(Path.GetDirectoryName(full)!);
        pending = ".pending-" + Guid.NewGuid().ToString("D"); name = Path.GetFileName(full);
        try
        {
            var handle = Posix.Handle(Posix.OpenAt(Posix.Descriptor(directory), pending, Posix.ReadWrite | Posix.Create | Posix.Exclusive | Posix.NoFollow | Posix.CloseOnExec, 0x180));
            try { Stream = new(handle, FileAccess.ReadWrite, 65536); } catch { handle.Dispose(); throw; }
        }
        catch { directory.Dispose(); throw; }
    }

    public void Commit()
    {
        if (disposed || committed) throw new InvalidOperationException("Atomic file is no longer writable");
        Stream.Flush(true); Stream.Dispose();
        var descriptor = Posix.Descriptor(directory);
        if (Posix.RenameAt(descriptor, pending, descriptor, name) != 0) throw Posix.Failure();
        committed = true;
        if (Posix.Sync(descriptor) != 0) throw Posix.Failure();
    }

    public void Dispose()
    {
        if (disposed) return; disposed = true;
        try
        {
            Stream.Dispose();
            if (!committed && Posix.UnlinkAt(Posix.Descriptor(directory), pending, 0) != 0 && Marshal.GetLastPInvokeError() != 2) throw Posix.Failure();
        }
        finally { directory.Dispose(); }
    }
}
