using Crossfire.AdapterProcess;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.AdapterExecution.Vm;
using Fleetd.Domain;

static class ResourcesAcceptance
{
    public static async Task Run(string root, Action<bool, string> check)
    {
        var memory = Resources.ParseMemory("MemTotal: 8388608 kB\nMemFree: 123 kB\nMemAvailable: 4194304 kB\n");
        check(memory.IsSuccess && memory.Value == new VmMemory(8388608, 4194304), "Host admission uses available memory rather than free pages");
        check(!Resources.ParseMemory("MemTotal: 1 kB\nMemAvailable: 2 kB\n").IsSuccess
            && !Resources.ParseMemory("MemTotal: 8 kB\nMemTotal: 8 kB\nMemAvailable: 2 kB\n").IsSuccess
            && !Resources.ParseMemory("MemTotal: 8388608 MB\nMemAvailable: 2 kB\n").IsSuccess, "Malformed memory units, duplicates and impossible counters fail closed");
        var profile = new VmProfile(1, 256, 256, VmNetwork.Disabled, []);
        var catalog = new ExecutionCatalog(1024, 256, new Dictionary<string, VmImage>(), new Dictionary<string, VmProfile>());
        check(Resources.Admit(catalog, profile, memory.Value).IsSuccess, "A finite fleet budget admits a fitting target plus helper headroom");
        check(!Resources.Admit(catalog, profile, new(8388608, 1000000)).IsSuccess, "Insufficient available memory retains the configured host reserve");
        check(!Resources.Admit(catalog with { MemoryBudgetMiB = 8192 }, profile, memory.Value).IsSuccess, "Fleet maximum plus host reserve must fit physical memory");
        var slice = Resources.Slice(root); var id = Identity.Identifier();
        var program = "import json,pathlib; p=pathlib.Path('/sys/fs/cgroup'+pathlib.Path('/proc/self/cgroup').read_text().strip()[3:]); print(json.dumps({'group':str(p),'memory':(p/'memory.max').read_text().strip(),'swap':(p/'memory.swap.max').read_text().strip(),'tasks':(p/'pids.max').read_text().strip(),'fleetMemory':(p.parent/'memory.max').read_text().strip(),'fleetTasks':(p.parent/'pids.max').read_text().strip()}))";
        var scoped = Resources.Service(root, id, catalog.MemoryBudgetMiB, profile,
            new("/usr/bin/python3", ["-c", program], root, new Dictionary<string, string?>()));
        check(scoped.IsSuccess, "VM supervisor receives a finite service inside the fleet slice");
        if (!scoped.IsSuccess) throw new IOException(scoped.Error.Message);
        try
        {
            var configured = await NativeProcess.Capture(Resources.Configure(root, catalog.MemoryBudgetMiB), 8192, 10000, CancellationToken.None);
            check(configured.IsSuccess && configured.Value.ExitCode == 0, "Actual user manager configures the isolated fixture fleet budget");
            if (!configured.IsSuccess || configured.Value.ExitCode != 0) throw new IOException(configured.IsSuccess ? configured.Value.Errors : configured.Error.Message);
            var output = await NativeProcess.Capture(scoped.Value, 16384, 10000, CancellationToken.None);
            check(output.IsSuccess && output.Value.ExitCode == 0, "Actual systemd service runs the fixture without a model");
            if (!output.IsSuccess || output.Value.ExitCode != 0) throw new IOException(output.IsSuccess ? output.Value.Errors : output.Error.Message);
            var value = WireJson.Parse(System.Text.Encoding.UTF8.GetBytes(output.Value.Output));
            check(value.GetProperty("memory").GetString() == "805306368" && value.GetProperty("swap").GetString() == "0"
                && value.GetProperty("tasks").GetString() == "1024", "Guest and helper processes share the actual finite memory, swap and task limits");
            check(value.GetProperty("fleetMemory").GetString() == "1073741824" && value.GetProperty("fleetTasks").GetString() == "1024"
                && value.GetProperty("group").GetString()!.EndsWith(slice + "/ctlflow-execution-" + id + ".service", StringComparison.Ordinal),
                "Actual execution service is charged to its exact aggregate fleet budget");
        }
        finally
        {
            foreach (var operation in new[] { "stop", "revert" })
            {
                var closed = await NativeProcess.Capture(new("/usr/bin/systemctl", ["--user", operation, slice], root,
                    new Dictionary<string, string?>()), 8192, 10000, CancellationToken.None);
                check(closed.IsSuccess && closed.Value.ExitCode == 0, "Only the exact isolated fixture slice is " + operation + "ed");
            }
        }
    }
}
