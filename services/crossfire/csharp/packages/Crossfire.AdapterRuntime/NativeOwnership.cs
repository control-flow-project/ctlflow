using Crossfire.AdapterFilesystem;

namespace Crossfire.AdapterRuntime;

public static class NativeOwnership
{
    private static bool Absolute(string path) => path.StartsWith('/') && !path.Contains('\\')
        && !path.Contains('\0') && (path == "/" || path.Split('/').Skip(1).All(part => part.Length != 0 && part is not ("." or "..")));
    // Native storage may be exported to another kernel. Its ownership lease must
    // remain exclusively in the host kernel and outside every exported tree.
    public static string Prepare(string directory, string workspace, string home)
    {
        if (!Absolute(directory))
            throw new IOException("Native ownership requires an exact absolute host directory");
        foreach (var exported in new[] { workspace, home })
        {
            if (!Absolute(exported) || exported == "/"
                || directory == exported || directory.StartsWith(exported + "/", StringComparison.Ordinal))
                throw new IOException("Native ownership must remain outside the workspace and native home");
        }
        return PrivateFiles.Exists(directory) ? PrivateFiles.ExistingDirectory(directory, true) : PrivateFiles.Directory(directory);
    }
    public static StateLock Acquire(string directory, string workspace, string home)
    {
        var ownership = new StateLock(Path.Combine(Prepare(directory, workspace, home), "owner"));
        try { ExecutionState.RequireQuiescent(directory); return ownership; }
        catch { ownership.Dispose(); throw; }
    }
}
