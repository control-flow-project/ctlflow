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
        Equal(System.IO.Directory.GetFiles(directory, ".pending-*").Length, 0, "temporary state files removed");
        Throws(() => PrivateFiles.Read(path, 4), "private read byte bound");
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.OtherRead);
        Throws(() => PrivateFiles.Read(path, 1024), "publicly readable private state rejected");
        Throws(() => PrivateFiles.Database(path), "publicly readable database rejected");
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        var link = Path.Combine(directory, "link.json");
        File.CreateSymbolicLink(link, path);
        Throws(() => PrivateFiles.Read(link, 1024), "file symlink rejected");
        Throws(() => PrivateFiles.Write(link, bytes, 1024), "file symlink cannot be replaced");
        var directoryLink = Path.Combine(parent, "directory-link");
        System.IO.Directory.CreateSymbolicLink(directoryLink, directory);
        Throws(() => PrivateFiles.Directory(Path.Combine(directoryLink, "child")), "directory ancestor symlink rejected");
        Equal(System.IO.Directory.Exists(Path.Combine(directory, "child")), false, "rejected link performs no child creation");
    }

    private static void Throws(Action action, string label)
    {
        try { action(); }
        catch (IOException) { return; }
        throw new InvalidOperationException(label + ": expected rejection");
    }
}
