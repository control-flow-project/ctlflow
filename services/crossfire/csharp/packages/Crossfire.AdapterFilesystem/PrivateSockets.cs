using System.Net.Sockets;

namespace Crossfire.AdapterFilesystem;

public static class PrivateSockets
{
    public static IDisposable Own(string path)
    {
        PrivateFiles.UnixSocket(path); using var parent = PrivateFiles.PrivateDirectory(Path.GetDirectoryName(path)!); return new SocketOwnership(path, Posix.MetadataAt(parent, Path.GetFileName(path)));
    }
    private sealed class SocketOwnership(string path, FileMetadata original) : IDisposable
    {
        private int closed;
        public void Dispose()
        {
            if (Interlocked.Exchange(ref closed, 1) != 0) return; using var parent = PrivateFiles.PrivateDirectory(Path.GetDirectoryName(path)!); FileMetadata current;
            try { current = Posix.MetadataAt(parent, Path.GetFileName(path)); } catch (FileNotFoundException) { return; }
            if (current.Inode != original.Inode || current.DeviceMajor != original.DeviceMajor || current.DeviceMinor != original.DeviceMinor || (current.Mode & 0xf000) != 0xc000) throw new IOException("Owned Unix socket changed before shutdown; replacement was not removed");
            if (Posix.UnlinkAt(Posix.Descriptor(parent), Path.GetFileName(path), 0) != 0 || Posix.Sync(Posix.Descriptor(parent)) != 0) throw Posix.Failure();
        }
    }
    public static async ValueTask RemoveStale(string path, CancellationToken cancellation)
    {
        if (!PrivateFiles.Exists(path)) return; PrivateFiles.UnixSocket(path); using var parent = PrivateFiles.PrivateDirectory(Path.GetDirectoryName(path)!); var name = Path.GetFileName(path); var before = Posix.MetadataAt(parent, name);
        using var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified); using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation); deadline.CancelAfter(2000);
        try { await socket.ConnectAsync(new UnixDomainSocketEndPoint(path), deadline.Token); throw new IOException("Controller is already running on the selected private socket"); }
        catch (SocketException error) when (error.SocketErrorCode == SocketError.ConnectionRefused)
        {
            var current = Posix.MetadataAt(parent, name); if (current.Inode != before.Inode || current.DeviceMajor != before.DeviceMajor || current.DeviceMinor != before.DeviceMinor) throw new IOException("Controller socket changed during startup"); if (Posix.UnlinkAt(Posix.Descriptor(parent), name, 0) != 0 || Posix.Sync(Posix.Descriptor(parent)) != 0) throw Posix.Failure();
        }
    }
}
