using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.Kernel;
using Fleetd.AdapterExecution.Vm;
using Fleetd.Domain;

static class BudgetAcceptance
{
    public static async Task Run(string root, Action<bool, string> check)
    {
        var fleet = PrivateFiles.Directory(Path.Combine(root, "fleet")); var control = PrivateFiles.Directory(Path.Combine(root, "control"));
        var profile = new VmProfile(1, 256, 256, VmNetwork.Disabled, []);
        var catalog = new ExecutionCatalog(1024, 256, new Dictionary<string, VmImage>(), new Dictionary<string, VmProfile>());
        var slice = Resources.Slice(fleet); NativeProcess? process = null; VmBudgetLease? admission = null;
        var firstId = Identity.Identifier(); var secondId = Identity.Identifier();
        try
        {
            var opened = await Budget.Open(fleet, control, catalog, profile, CancellationToken.None);
            check(opened.IsSuccess, "Initial fleet resource admission is serialized under its host lock");
            if (!opened.IsSuccess) throw new IOException(opened.Error.Message); admission = opened.Value;
            check(admission.Reserve(firstId).IsSuccess, "The first guest target is reserved under the shared fleet lock");
            var program = "import sys;print('ready',flush=True);sys.stdin.readline()";
            var scope = Resources.Service(fleet, firstId, catalog.MemoryBudgetMiB, profile,
                new("/usr/bin/python3", ["-c", program], fleet, new Dictionary<string, string?>(), true));
            if (!scope.IsSuccess) throw new IOException(scope.Error.Message);
            var started = NativeProcess.Start(scope.Value); if (!started.IsSuccess) throw new IOException(started.Error.Message); process = started.Value;
            var ready = await process.Output.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10));
            check(ready == "ready", "A real scoped fixture remains live during a second fleet admission");
            admission.Dispose(); admission = null;
            var same = await Budget.Open(fleet, control, catalog, profile, CancellationToken.None);
            check(same.IsSuccess, "The identical budget admits another execution without reconfiguring the live slice");
            if (!same.IsSuccess) throw new IOException(same.Error.Message);
            using (same.Value) check(!same.Value.Reserve(secondId).IsSuccess, "Concurrent guests cannot overcommit target memory and helper headroom beyond the fleet budget");
            var different = await Budget.Open(fleet, control, catalog with { MemoryBudgetMiB = 1536 }, profile, CancellationToken.None);
            check(!different.IsSuccess && different.Error.Code == "conflict", "A different budget cannot change a populated fleet slice");
            check(!process.Ended.IsCompleted, "Rejecting the budget change does not interrupt the existing execution");
            await process.Input.WriteLineAsync("close"); await process.Input.FlushAsync(); process.Input.Close();
            await process.Ended.WaitAsync(TimeSpan.FromSeconds(10));
            check(process.ExitCode == 0, "The original scoped execution closes normally after its explicit input");
            await process.DisposeAsync(); process = null;
            var changed = await Budget.Open(fleet, control, catalog with { MemoryBudgetMiB = 1536 }, profile, CancellationToken.None);
            check(changed.IsSuccess, "Budget changes are admitted after all previous executions have closed");
            if (!changed.IsSuccess) throw new IOException(changed.Error.Message);
            using (changed.Value)
            {
                check(changed.Value.Reserve(secondId).IsSuccess
                    && !File.Exists(Path.Combine(control, "targets", firstId + ".json")), "A closed service's stale target is pruned before admitting its successor");
                var unexpected = PrivateFiles.Directory(Path.Combine(control, "targets", "unexpected-directory"));
                var rejected = false;
                try { changed.Value.Reserve(Identity.Identifier()); } catch (IOException) { rejected = true; }
                check(rejected, "Fleet accounting rejects unexpected directory entries rather than silently ignoring them");
                Directory.Delete(unexpected);
            }
        }
        finally
        {
            admission?.Dispose(); if (process is not null) await process.DisposeAsync();
            foreach (var operation in new[] { "stop", "revert" })
            {
                var closed = await NativeProcess.Capture(new("/usr/bin/systemctl", ["--user", operation, slice], fleet,
                    new Dictionary<string, string?>()), 8192, 10000, CancellationToken.None);
                check(closed.IsSuccess && closed.Value.ExitCode == 0, "The exact fixture resource slice is " + operation + "ed after admission tests");
            }
        }
    }
}
