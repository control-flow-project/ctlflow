using Crossfire.AdapterFilesystem;
using Crossfire.Contracts;
using Crossfire.AdapterProcess;
using Fleetd.Contracts;

namespace Fleetd.AdapterExecution.Vm;

// Only sockets belong on /run's tmpfs. Guest disks and boot files use the
// operator's ordinary cache filesystem and are disposable after guest closure.
public static class ExecutionFiles
{
    public static string Runtime(string id)
    {
        if (!Validation.Identifier(id)) throw new IOException("Invalid VM execution identity");
        var root = Environment.GetEnvironmentVariable("XDG_RUNTIME_DIR") ?? throw new IOException("VM execution requires the private user runtime directory");
        PrivateFiles.ExistingDirectory(root, true);
        var path = Path.Combine(root, "cfvm-" + id);
        if (System.Text.Encoding.UTF8.GetByteCount(path) >= 70) throw new IOException("VM runtime socket directory exceeds its Unix socket path bound");
        var checkedPath = SshCommands.Check(path, id); if (!checkedPath.IsSuccess) throw new IOException(checkedPath.Error.Message);
        return path;
    }
    public static string CacheRoot
    {
        get
        {
            var home = Environment.GetEnvironmentVariable("HOME") ?? throw new IOException("VM execution requires HOME");
            var cache = Environment.GetEnvironmentVariable("XDG_CACHE_HOME") ?? Path.Combine(home, ".cache");
            if (!FleetConfigurationContract.Absolute(cache) || cache.Any(char.IsControl)) throw new IOException("VM cache requires an exact absolute directory");
            return Path.Combine(cache, "ctlflow", "vm");
        }
    }
    public static string Scratch(string id)
    {
        if (!Validation.Identifier(id)) throw new IOException("Invalid VM execution identity");
        return Path.Combine(CacheRoot, id);
    }
    public static void Create(string id)
    { PrivateFiles.Directory(Runtime(id)); PrivateFiles.Directory(Scratch(id)); }
    public static void Remove(string id)
    {
        foreach (var path in new[] { Scratch(id), Runtime(id) })
        {
            if (!PrivateFiles.Exists(path)) continue;
            PrivateFiles.ExistingDirectory(path, true);
            Directory.Delete(path, recursive: true);
        }
    }
}
