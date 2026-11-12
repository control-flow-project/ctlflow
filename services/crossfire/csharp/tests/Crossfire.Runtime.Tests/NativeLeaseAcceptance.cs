using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.AdapterRuntime;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

internal static class NativeLeaseAcceptance
{
    internal static async Task Verify()
    {
        var root = PrivateFiles.Directory(Path.Combine(Path.GetTempPath(), "native-lease-" + Identity.Identifier()));
        try
        {
            var workspace = PrivateFiles.Directory(Path.Combine(root, "workspace"));
            var directory = PrivateFiles.Directory(Path.Combine(root, "control"));
            var home = Path.Combine(workspace, ".codex");
            var owner = NativeOwnership.Acquire(directory, workspace, home);
            var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var finish = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously); var calls = 0;
            var lease = new NativeLease(NativeExecution.Host, async () =>
            {
                Interlocked.Increment(ref calls); entered.TrySetResult();
                await finish.Task; owner.Dispose();
            });
            var first = lease.DisposeAsync().AsTask(); var second = lease.DisposeAsync().AsTask();
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Equal(first.IsCompleted || second.IsCompleted, false, "Concurrent closes wait for actual execution teardown");
            var refused = await NativePlacement.Host.Open(new(directory, workspace, workspace, home), CancellationToken.None);
            Equal(refused.IsSuccess, false, "No successor owns native files while execution teardown is pending");
            finish.TrySetResult(); await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(5));
            Equal(calls, 1, "Execution teardown runs once for all concurrent closes");
            var successor = await NativePlacement.Host.Open(new(directory, workspace, workspace, home), CancellationToken.None);
            Equal(successor.IsSuccess, true, "A successor is admitted after execution teardown releases ownership");
            await successor.Value.DisposeAsync();
            var failed = new NativeLease(NativeExecution.Host, () => ValueTask.FromException(new IOException("Unconfirmed execution closure")));
            foreach (var attempt in new[] { failed.DisposeAsync().AsTask(), failed.DisposeAsync().AsTask() })
            {
                try { await attempt; throw new InvalidOperationException("Unconfirmed closure reported success"); }
                catch (IOException error) { Equal(error.Message, "Unconfirmed execution closure", "Every observer sees the execution cleanup failure"); }
            }
            var id = Identity.Identifier(); var group = ExecutionState.CurrentGroup();
            using (var metadata = new StateLock(Path.Combine(directory, "owner"))) ExecutionState.Publish(directory, new(id, group));
            var surviving = await NativePlacement.Host.Open(new(directory, workspace, workspace, home), CancellationToken.None);
            Equal(surviving.IsSuccess, false, "Surviving execution processes block a new writer after the supervisor lease is gone");
            Equal(Directory.Exists(home), false, "Blocked execution cannot prepare native-home files");
            try { ExecutionState.RemoveClosed(directory, id); throw new InvalidOperationException("Live execution record was removed"); }
            catch (IOException error) { Equal(error.Message, "A previous native execution still has live resource-group processes", "Cleanup refuses to hide surviving execution"); }
            var empty = Path.GetDirectoryName(group)! + "/ctlflow-vm-" + Identity.Identifier().Replace("-", "", StringComparison.Ordinal) + ".scope";
            using (var metadata = new StateLock(Path.Combine(directory, "owner"))) ExecutionState.Publish(directory, new(id, empty));
            Equal(ExecutionState.RemoveClosed(directory, Identity.Identifier()), false, "An older cleanup cannot remove another execution identity");
            Equal(ExecutionState.RemoveClosed(directory, id), true, "A matching record is removed only after its resource group is absent or empty");
            var recovered = await NativePlacement.Host.Open(new(directory, workspace, workspace, home), CancellationToken.None);
            Equal(recovered.IsSuccess, true, "Native admission recovers after confirmed resource-group closure");
            await recovered.Value.DisposeAsync();
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
