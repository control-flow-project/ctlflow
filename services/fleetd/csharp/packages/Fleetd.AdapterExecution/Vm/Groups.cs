using System.Diagnostics;
using System.Globalization;
using Crossfire.AdapterRuntime;

namespace Fleetd.AdapterExecution.Vm;

internal static class Groups
{
    private static string Current => "/sys/fs/cgroup" + ExecutionState.CurrentGroup();
    public static void Validate(VmRequest request, VmSelection selection)
    {
        var group = ExecutionState.CurrentGroup();
        if (!group.EndsWith("/" + Resources.Slice(request.Fleet) + "/" + request.Unit, StringComparison.Ordinal))
            throw new IOException("VM supervisor must run in its exact finite fleet user service");
        var maximum = Math.Min(selection.Catalog.MemoryBudgetMiB, selection.Profile.MaximumMemoryMiB + (long)Resources.HelperMiB) * 1048576;
        Require(Current, "memory.max", maximum); Require(Current, "memory.swap.max", 0); Require(Current, "pids.max", Resources.Tasks);
        Require(Path.GetDirectoryName(Current)!, "memory.max", selection.Catalog.MemoryBudgetMiB * 1048576L);
        Require(Path.GetDirectoryName(Current)!, "memory.swap.max", 0);
        Require(Path.GetDirectoryName(Current)!, "pids.max", Resources.Tasks);
    }
    private static void Require(string root, string file, long expected)
    {
        if (File.ReadAllText(Path.Combine(root, file)).Trim() != expected.ToString(CultureInfo.InvariantCulture))
            throw new IOException("VM resource containment does not match its configured " + file);
    }
    private static IReadOnlyList<int> Members()
    {
        var directories = new Queue<string>(); directories.Enqueue(Current); var visited = 0; HashSet<int> members = [];
        while (directories.TryDequeue(out var directory))
        {
            if (++visited > Resources.Tasks) throw new IOException("VM resource hierarchy exceeds its task bound");
            foreach (var line in File.ReadAllLines(Path.Combine(directory, "cgroup.procs")))
                if (int.TryParse(line, NumberStyles.None, CultureInfo.InvariantCulture, out var pid)) members.Add(pid);
                else throw new IOException("Invalid VM resource-group process identity");
            foreach (var child in Directory.GetDirectories(directory)) directories.Enqueue(child);
        }
        return members.ToArray();
    }
    public static bool Ready(int exports)
    {
        var names = Members().Select(pid =>
        {
            try { return File.ReadAllText("/proc/" + pid.ToString(CultureInfo.InvariantCulture) + "/comm").Trim(); }
            catch (FileNotFoundException) { return ""; }
            catch (DirectoryNotFoundException) { return ""; }
        }).ToArray();
        return names.Count(name => name.StartsWith("qemu-system", StringComparison.Ordinal)) == 1 && names.Count(name => name == "virtiofsd") >= exports;
    }
    public static async Task Closed()
    {
        var elapsed = Stopwatch.StartNew();
        while (Members().Any(pid => pid != Environment.ProcessId))
        {
            if (elapsed.Elapsed >= TimeSpan.FromSeconds(10)) throw new IOException("VM helpers remain alive in their execution group; retain its ownership fence");
            await Task.Delay(25);
        }
    }
}
