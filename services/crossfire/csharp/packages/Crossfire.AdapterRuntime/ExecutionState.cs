using System.Text;
using Crossfire.AdapterFilesystem;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterRuntime;

public sealed record NativeExecutionState(string Id, string Group);

// This record stays with the host lease. It outlives a killed supervisor and
// prevents another kernel opening native SQL while execution helpers survive.
public static class ExecutionState
{
    private const string FileName = "execution.json";
    public static string CurrentGroup()
    {
        var lines = File.ReadAllLines("/proc/self/cgroup");
        if (lines.Length != 1 || !lines[0].StartsWith("0::/user.slice/", StringComparison.Ordinal))
            throw new IOException("VM execution requires a cgroup v2 user resource group");
        return lines[0][3..];
    }
    private static bool Group(string group)
    {
        var current = CurrentGroup().Split('/');
        return current.Length >= 5 && current[2].StartsWith("user-", StringComparison.Ordinal) && current[2].EndsWith(".slice", StringComparison.Ordinal)
            && current[3].StartsWith("user@", StringComparison.Ordinal) && current[3].EndsWith(".service", StringComparison.Ordinal)
            && group.StartsWith(string.Join('/', current.Take(4)) + "/", StringComparison.Ordinal)
            && group.Length <= 4096 && (group.EndsWith(".scope", StringComparison.Ordinal) || group.EndsWith(".service", StringComparison.Ordinal))
            && group.Split('/').Skip(1).All(part => part.Length != 0 && part is not ("." or "..")
                && part.All(character => char.IsAsciiLetterOrDigit(character) || character is '.' or '-' or '_' or '@'));
    }
    private static NativeExecutionState? Read(string directory)
    {
        var file = Path.Combine(directory, FileName); if (!PrivateFiles.Exists(file)) return null;
        var value = WireJson.Parse(PrivateFiles.Read(file, 8192));
        if (!Validation.Fields(value, ["id", "group"]).IsSuccess || WireJson.Text(value, "id") is not { } id || !Validation.Identifier(id)
            || WireJson.Text(value, "group") is not { } group || !Group(group))
            throw new IOException("Invalid host native execution record");
        return new(id, group);
    }
    // Caller retains the host owner lock throughout publication and VM launch.
    public static void Publish(string directory, NativeExecutionState state)
    {
        if (!Validation.Identifier(state.Id) || !Group(state.Group)) throw new IOException("Invalid host native execution identity or resource group");
        PrivateFiles.ExistingDirectory(directory, true);
        var value = WireJson.Object(writer => { writer.WriteString("id", state.Id); writer.WriteString("group", state.Group); });
        PrivateFiles.Write(Path.Combine(directory, FileName), Encoding.UTF8.GetBytes(value.GetRawText()), 8192);
    }
    private static void Quiescent(NativeExecutionState state)
    {
        try
        {
            using var file = File.OpenRead("/sys/fs/cgroup" + state.Group + "/cgroup.events");
            Span<byte> bytes = stackalloc byte[4097]; var length = 0;
            while (length < bytes.Length) { var read = file.Read(bytes[length..]); if (read == 0) break; length += read; }
            if (length > 4096) throw new IOException("Native execution resource-group state exceeds its bound");
            var populated = Encoding.ASCII.GetString(bytes[..length]).Split('\n').Where(line => line.StartsWith("populated ", StringComparison.Ordinal)).ToArray();
            if (populated.Length != 1 || populated[0] is not ("populated 0" or "populated 1")) throw new IOException("Cannot establish native execution resource-group state");
            if (populated[0] != "populated 0") throw new IOException("A previous native execution still has live resource-group processes");
        }
        catch (DirectoryNotFoundException) { }
        catch (FileNotFoundException) { }
    }
    public static void RequireQuiescent(string directory)
    { var state = Read(directory); if (state is not null) Quiescent(state); }
    // Caller retains the host ownership lock. The VM owner may now discard
    // only the closed execution's derived disposable filesystem roots.
    public static string? ClosedId(string directory)
    { var state = Read(directory); if (state is null) return null; Quiescent(state); return state.Id; }

    public static bool RemoveClosed(string directory, string id)
    {
        StateLock owner;
        try { owner = new(Path.Combine(directory, "owner")); }
        catch (IOException error) when (error.Message == "Another process already owns this private state") { return false; }
        using (owner)
        {
            var state = Read(directory); if (state is null || state.Id != id) return false;
            Quiescent(state); PrivateFiles.DeletePrivate(Path.Combine(directory, FileName)); return true;
        }
    }
}
