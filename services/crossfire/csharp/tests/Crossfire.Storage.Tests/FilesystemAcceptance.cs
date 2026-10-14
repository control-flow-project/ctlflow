using System.Text;
using Crossfire.AdapterFilesystem;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class FilesystemAcceptance
{
    public static void Verify(string parent)
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("Native filesystem verification requires Linux");
        var directory = Path.Combine(parent, "filesystem");
        Equal(PrivateFiles.Directory(directory), directory, "owned private directory creation");
        Equal(File.GetUnixFileMode(directory) & (UnixFileMode.GroupRead | UnixFileMode.GroupWrite | UnixFileMode.GroupExecute
            | UnixFileMode.OtherRead | UnixFileMode.OtherWrite | UnixFileMode.OtherExecute), (UnixFileMode)0, "private directory permission bits");
        var path = Path.Combine(directory, "state.json");
        var bytes = Encoding.UTF8.GetBytes("{\"state\":\"first\"}");
        PrivateFiles.Write(path, bytes, 1024);
        Equal(Encoding.UTF8.GetString(PrivateFiles.Read(path, 1024)), Encoding.UTF8.GetString(bytes), "atomic private state roundtrip");
        PrivateFiles.Write(path, Encoding.UTF8.GetBytes("{\"state\":\"second\"}"), 1024);
        Equal(Encoding.UTF8.GetString(PrivateFiles.Read(path, 1024)), "{\"state\":\"second\"}", "atomic state replacement");
        using (var handle = PrivateFiles.OpenPrivate(path))
        {
            Equal(handle.IsAsync, false, "validated regular files cannot retain pipe-style nonblocking semantics");
            var first = new byte[1]; var last = new byte[1];
            Equal(RandomAccess.Read(handle, last, RandomAccess.GetLength(handle) - 1), 1, "private file supports positioned tail read");
            Equal(RandomAccess.Read(handle, first, 0), 1, "private file supports a following positioned head read");
            Equal(first[0], (byte)'{', "positioned private reads do not silently use stream position");
        }
        Equal(System.IO.Directory.GetFiles(directory, ".pending-*").Length, 0, "temporary state files removed");
        Throws(() => PrivateFiles.Read(path, 4), "private read byte bound");
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.OtherRead);
        Throws(() => PrivateFiles.Read(path, 1024), "publicly readable private state rejected");
        Throws(() => PrivateFiles.Database(path), "publicly readable database rejected");
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        var missing = Path.Combine(directory, "must-not-be-created.sqlite");
        Throws(() => PrivateFiles.Database(missing), "database open does not create files");
        Equal(File.Exists(missing), false, "rejected database open preserves missing file");
        File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.OtherRead);
        Throws(() => PrivateFiles.Database(path), "public database parent rejected");
        File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var link = Path.Combine(directory, "link.json");
        File.CreateSymbolicLink(link, path);
        Throws(() => PrivateFiles.Read(link, 1024), "file symlink rejected");
        Throws(() => PrivateFiles.Write(link, bytes, 1024), "file symlink cannot be replaced");
        var directoryLink = Path.Combine(parent, "directory-link");
        System.IO.Directory.CreateSymbolicLink(directoryLink, directory);
        Throws(() => PrivateFiles.Directory(Path.Combine(directoryLink, "child")), "directory ancestor symlink rejected");
        Equal(System.IO.Directory.Exists(Path.Combine(directory, "child")), false, "rejected link performs no child creation");
        DiagnosticAcceptance.Verify(parent);
    }

    private static void Throws(Action action, string label)
    {
        try { action(); }
        catch (IOException) { return; }
        throw new InvalidOperationException(label + ": expected rejection");
    }
}
