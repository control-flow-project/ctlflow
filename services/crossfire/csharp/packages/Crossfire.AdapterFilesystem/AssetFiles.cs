using Microsoft.Win32.SafeHandles;

namespace Crossfire.AdapterFilesystem;

public static class AssetFiles
{
    public static FileStream Open(string root, string relative)
    {
        var parts = relative.Split('/');
        if (parts.Length == 0 || parts.Any(part => part.Length == 0 || part.StartsWith('.') || part.Any(character => character is '\\' or '\0' or '/' || char.IsControl(character))))
            throw new IOException("Invalid static asset path");
        var parent = PrivateFiles.OpenDirectory(root, false, false);
        try
        {
            foreach (var part in parts[..^1])
            {
                var next = Posix.Handle(Posix.OpenAt(Posix.Descriptor(parent), part, Posix.ReadOnly | Posix.Directory | Posix.NoFollow | Posix.CloseOnExec, 0));
                parent.Dispose(); parent = next;
            }
            var file = Posix.Handle(Posix.OpenAt(Posix.Descriptor(parent), parts[^1], Posix.ReadOnly | Posix.NoFollow | Posix.NonBlock | Posix.CloseOnExec, 0));
            try
            {
                Posix.RegularFile(file);
                return new(file, FileAccess.Read, 65536, isAsync: false);
            }
            catch { file.Dispose(); throw; }
        }
        finally { parent.Dispose(); }
    }
}
