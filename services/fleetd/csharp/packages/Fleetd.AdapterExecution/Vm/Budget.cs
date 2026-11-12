using System.Globalization;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.AdapterRuntime;
using Crossfire.Kernel;
using Crossfire.Contracts;
using Fleetd.Contracts;
using Fleetd.Domain;

namespace Fleetd.AdapterExecution.Vm;

// Retained only across resource admission and guest startup. The supervisor
// keeps its separate native-writer lease through the entire execution lifetime.
public sealed class VmBudgetLease(StateLock ownership, string directory, string group, int maximumMiB, int targetMiB) : IDisposable
{
    public void Dispose() => ownership.Dispose();
    public Result<Unit> Reserve(string id) => Budget.Reserve(directory, group, maximumMiB, targetMiB, id);
}

public static class Budget
{
    internal static Result<Unit> Reserve(string control, string group, int maximumMiB, int targetMiB, string id)
    {
        if (!Validation.Identifier(id)) return Results.Fail<Unit>("invalid", "Invalid VM target reservation identity");
        var directory = PrivateFiles.Directory(Path.Combine(control, "targets")); long used = 0;
        var files = Directory.GetFileSystemEntries(directory); if (files.Length > 10000) throw new IOException("Too many fleet VM target records");
        foreach (var file in files)
        {
            var value = WireJson.Parse(PrivateFiles.Read(file, 4096));
            if (!Validation.Fields(value, ["id", "targetMiB"]).IsSuccess || WireJson.Text(value, "id") is not { } identity
                || !Validation.Identifier(identity) || Path.GetFileName(file) != identity + ".json"
                || !Validation.Integer(value.GetProperty("targetMiB"), 768, 1049088).IsSuccess)
                throw new IOException("Invalid private fleet VM target record");
            var unit = "ctlflow-execution-" + identity + ".service";
            if (group.Length != 0 && Populated(group + "/" + unit, unit)) used += value.GetProperty("targetMiB").GetInt64();
            else PrivateFiles.DeletePrivate(file);
        }
        if (used + targetMiB > maximumMiB) return Results.Fail<Unit>("unavailable", "Live guest targets and helper headroom fill this fleet's memory budget");
        PrivateFiles.Write(Path.Combine(directory, id + ".json"), WireJson.Bytes(WireJson.Object(writer =>
        { writer.WriteString("id", id); writer.WriteNumber("targetMiB", targetMiB); })), 4096);
        return Results.Done();
    }
    public static void Remove(string control, string id)
    {
        if (!Validation.Identifier(id)) throw new IOException("Invalid VM target reservation identity");
        StateLock owner;
        try { owner = new(Path.Combine(control, "vm-budget")); }
        catch (IOException error) when (error.Message == "Another process already owns this private state") { return; }
        using (owner)
        {
            var file = Path.Combine(control, "targets", id + ".json"); if (PrivateFiles.Exists(file)) PrivateFiles.DeletePrivate(file);
        }
    }
    private static bool Populated(string group, string slice)
    {
        var current = ExecutionState.CurrentGroup().Split('/');
        if (current.Length < 5 || !group.StartsWith(string.Join('/', current.Take(4)) + "/", StringComparison.Ordinal)
            || !group.EndsWith("/" + slice, StringComparison.Ordinal) || group.Length > 4096
            || group.Split('/').Skip(1).Any(part => part.Length == 0 || part is "." or ".."
                || part.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not ('.' or '-' or '_' or '@'))))
            throw new IOException("Fleet VM budget is outside the current user's resource hierarchy");
        try
        {
            using var file = File.OpenRead("/sys/fs/cgroup" + group + "/cgroup.events");
            Span<byte> bytes = stackalloc byte[4097]; var length = 0;
            while (length < bytes.Length) { var count = file.Read(bytes[length..]); if (count == 0) break; length += count; }
            if (length > 4096) throw new IOException("Fleet resource-group state exceeds its bound");
            var lines = System.Text.Encoding.ASCII.GetString(bytes[..length]).Split('\n');
            string? populated = null;
            foreach (var line in lines)
            {
                if (!line.StartsWith("populated ", StringComparison.Ordinal)) continue;
                if (populated is not null || line is not ("populated 0" or "populated 1")) throw new IOException("Invalid fleet resource-group state");
                populated = line;
            }
            return populated == "populated 1" ? true : populated == "populated 0" ? false : throw new IOException("Missing fleet resource-group state");
        }
        catch (DirectoryNotFoundException) { return false; }
        catch (FileNotFoundException) { return false; }
    }

    public static async ValueTask<Result<VmBudgetLease>> Open(string fleetDirectory, string controlDirectory,
        ExecutionCatalog catalog, VmProfile profile, CancellationToken cancellation)
    {
        if (!FleetConfigurationContract.Absolute(fleetDirectory) || !FleetConfigurationContract.Absolute(controlDirectory)
            || controlDirectory == fleetDirectory || controlDirectory.StartsWith(fleetDirectory + "/", StringComparison.Ordinal))
            return Results.Fail<VmBudgetLease>("invalid", "Fleet VM resource ownership must remain outside the fleet data directory");
        StateLock? owner = null;
        try
        {
            PrivateFiles.OwnedDirectory(fleetDirectory, allowGroupWrite: true); PrivateFiles.ExistingDirectory(controlDirectory, true);
            using var waiting = CancellationTokenSource.CreateLinkedTokenSource(cancellation); waiting.CancelAfter(TimeSpan.FromSeconds(30));
            while (owner is null)
            {
                waiting.Token.ThrowIfCancellationRequested();
                try { owner = new StateLock(Path.Combine(controlDirectory, "vm-budget")); }
                catch (IOException error) when (error.Message == "Another process already owns this private state")
                { await Task.Delay(25, waiting.Token); }
            }
            var admitted = Resources.ParseMemory(await File.ReadAllTextAsync("/proc/meminfo", cancellation))
                .Bind(memory => Resources.Admit(catalog, profile, memory));
            if (!admitted.IsSuccess) return Result<VmBudgetLease>.Fail(admitted.Error);
            var slice = Resources.Slice(fleetDirectory);
            var observed = await NativeProcess.Capture(new("/usr/bin/systemctl", ["--user", "show",
                "--property=LoadState,ControlGroup,MemoryMax,MemorySwapMax,TasksMax", "--", slice], fleetDirectory, new Dictionary<string, string?>()),
                16384, 10000, cancellation);
            if (!observed.IsSuccess) return Result<VmBudgetLease>.Fail(observed.Error);
            if (observed.Value.ExitCode != 0) return Results.Fail<VmBudgetLease>("unavailable", "Cannot inspect the fleet VM resource budget");
            var fields = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var line in observed.Value.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
            {
                var separator = line.IndexOf('=');
                if (separator <= 0 || !fields.TryAdd(line[..separator], line[(separator + 1)..])) throw new IOException("Invalid user-manager budget metadata");
            }
            if (fields.Count != 5 || fields.GetValueOrDefault("LoadState") != "loaded"
                || !fields.ContainsKey("ControlGroup") || !fields.ContainsKey("MemoryMax") || !fields.ContainsKey("MemorySwapMax") || !fields.ContainsKey("TasksMax"))
                throw new IOException("Incomplete user-manager budget metadata");
            var same = fields["MemoryMax"] == (catalog.MemoryBudgetMiB * 1048576L).ToString(CultureInfo.InvariantCulture)
                && fields["MemorySwapMax"] == "0" && fields["TasksMax"] == Resources.Tasks.ToString(CultureInfo.InvariantCulture);
            var populated = fields["ControlGroup"].Length != 0 && Populated(fields["ControlGroup"], slice);
            if (populated && !same) return Results.Fail<VmBudgetLease>("conflict", "Stop this fleet's VM executions before changing its populated resource budget");
            if (!same)
            {
                var configured = await NativeProcess.Capture(Resources.Configure(fleetDirectory, catalog.MemoryBudgetMiB), 8192, 10000, cancellation);
                if (!configured.IsSuccess) return Result<VmBudgetLease>.Fail(configured.Error);
                if (configured.Value.ExitCode != 0) return Results.Fail<VmBudgetLease>("unavailable", "Cannot configure the fleet VM resource budget");
            }
            var lease = new VmBudgetLease(owner, controlDirectory, fields["ControlGroup"], catalog.MemoryBudgetMiB, profile.MemoryMiB + Resources.HelperMiB); owner = null; return Result<VmBudgetLease>.Success(lease);
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
        { return Results.Fail<VmBudgetLease>("unavailable", "Fleet VM resource admission remained busy for thirty seconds"); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        { return Results.Fail<VmBudgetLease>("unavailable", "Cannot establish the fleet VM resource budget: " + error.Message); }
        finally { owner?.Dispose(); }
    }
}
