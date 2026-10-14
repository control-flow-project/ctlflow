using System.Text;

namespace Crossfire.AdapterFilesystem;

public static class ManagedLinks
{
    public static string Read(string path)
    {
        var full = Path.GetFullPath(path); using var parent = PrivateFiles.PrivateDirectory(Path.GetDirectoryName(full)!); var name = Path.GetFileName(full); var before = Posix.MetadataAt(parent, name);
        if ((before.Mode & 0xf000) != 0xa000 || before.Owner != Posix.Owner()) throw new IOException("Managed client entry must be an owned symbolic link");
        var bytes = new byte[4097]; var count = Posix.ReadLinkAt(Posix.Descriptor(parent), name, bytes, (nuint)bytes.Length); if (count < 1 || count >= bytes.Length) throw new IOException("Invalid managed client link"); var after = Posix.MetadataAt(parent, name);
        if (before.Inode != after.Inode || before.DeviceMajor != after.DeviceMajor || before.DeviceMinor != after.DeviceMinor || before.ModifiedSeconds != after.ModifiedSeconds || before.ModifiedNanos != after.ModifiedNanos) throw new IOException("Managed client link changed during inspection"); return new UTF8Encoding(false, true).GetString(bytes, 0, (int)count);
    }
    public static void Replace(string path, string target)
    {
        if (target.Length is < 1 or > 4096 || target.StartsWith('/') || target.Contains('\\') || target.Split('/').Any(part => part.Length == 0 || part is "." or "..")) throw new IOException("Managed link must use an exact contained relative target");
        var full = Path.GetFullPath(path); using var parent = PrivateFiles.PrivateDirectory(Path.GetDirectoryName(full)!); var descriptor = Posix.Descriptor(parent); var name = Path.GetFileName(full); if (PrivateFiles.Exists(path)) Read(path); var pending = ".client-" + Guid.NewGuid().ToString("D");
        if (Posix.LinkAt(target, descriptor, pending) != 0) throw Posix.Failure();
        try { if (Posix.RenameAt(descriptor, pending, descriptor, name) != 0 || Posix.Sync(descriptor) != 0) throw Posix.Failure(); }
        finally { if (Posix.UnlinkAt(descriptor, pending, 0) != 0 && System.Runtime.InteropServices.Marshal.GetLastPInvokeError() != 2) throw Posix.Failure(); }
    }
    public static void PublishDirectory(string source, string destination)
    {
        PrivateFiles.ExistingDirectory(source, true); var originalParent = Path.GetDirectoryName(source)!; var destinationParent = Path.GetDirectoryName(destination)!; using var original = PrivateFiles.PrivateDirectory(originalParent); using var target = PrivateFiles.PrivateDirectory(destinationParent);
        if (Posix.RenameExclusive(Posix.Descriptor(original), Path.GetFileName(source), Posix.Descriptor(target), Path.GetFileName(destination), 1) != 0 || Posix.Sync(Posix.Descriptor(original)) != 0 || Posix.Sync(Posix.Descriptor(target)) != 0) throw Posix.Failure();
    }
}
