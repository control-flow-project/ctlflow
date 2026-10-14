namespace Crossfire.AdapterFilesystem;

public static class StateArchive
{
    public static void Move(string source, string target, Func<string, bool> selected)
    {
        PrivateFiles.ExistingDirectory(source, true); PrivateFiles.Directory(target);
        using var original = PrivateFiles.PrivateDirectory(source); using var archive = PrivateFiles.PrivateDirectory(target);
        foreach (var path in Directory.EnumerateFileSystemEntries(source).Where(path => selected(Path.GetFileName(path))))
        {
            var name = Path.GetFileName(path); var metadata = Posix.MetadataAt(original, name);
            if ((metadata.Mode & 0xf000) is not (0x8000 or 0x4000) || metadata.Owner != Posix.Owner() || (metadata.Mode & 0x3f) != 0)
                throw new IOException("Reset can archive only private owned native state");
            if (Posix.RenameExclusive(Posix.Descriptor(original), name, Posix.Descriptor(archive), name, 1) != 0) throw Posix.Failure();
        }
        if (Posix.Sync(Posix.Descriptor(original)) != 0 || Posix.Sync(Posix.Descriptor(archive)) != 0) throw Posix.Failure();
    }
}
