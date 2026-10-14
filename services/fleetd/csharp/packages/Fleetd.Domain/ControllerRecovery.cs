using Crossfire.Kernel;

namespace Fleetd.Domain;

public sealed partial class FleetController
{
    private Result<Unit> ChangeIntent(string fleet, IReadOnlyList<string> keys, bool enabled)
    {
        lock (gate)
        {
            var next = wanted.ToHashSet(); foreach (var key in keys) { if (enabled) next.Add((fleet, key)); else next.Remove((fleet, key)); }
            var saved = registry.SaveDesired(next.Select(key => new DesiredIntent(key.Fleet, key.Instance)).ToArray()); if (saved.IsSuccess) { wanted.Clear(); wanted.UnionWith(next); } return saved;
        }
    }
    private Result<Unit> SaveSelection(string fleet, IReadOnlyList<string> enabled, string? instance = null)
    {
        lock (gate)
        {
            var previous = selections.GetValueOrDefault(fleet); if (instance is null && enabled.Count == 0 && previous is not null) return Results.Done(); var next = new Dictionary<string, IReadOnlyList<string>>(selections, StringComparer.Ordinal);
            next[fleet] = instance is null ? enabled.Order(StringComparer.Ordinal).ToArray() : (previous ?? []).Concat(enabled).Distinct(StringComparer.Ordinal).Where(key => key != instance).Order(StringComparer.Ordinal).ToArray();
            var saved = registry.SaveSelections(next.Select(value => new ResumeSelection(value.Key, value.Value)).ToArray()); if (saved.IsSuccess) { selections.Clear(); foreach (var value in next) selections.Add(value.Key, value.Value); } return saved;
        }
    }
    private Result<Unit> ForgetSelection(string fleet, string? instance = null)
    {
        lock (gate)
        {
            if (!selections.TryGetValue(fleet, out var previous)) return Results.Done(); var next = new Dictionary<string, IReadOnlyList<string>>(selections, StringComparer.Ordinal); if (instance is null) next.Remove(fleet); else next[fleet] = previous.Where(key => key != instance).ToArray(); var saved = registry.SaveSelections(next.Select(value => new ResumeSelection(value.Key, value.Value)).ToArray());
            if (saved.IsSuccess) { selections.Clear(); foreach (var value in next) selections.Add(value.Key, value.Value); } return saved;
        }
    }
    private void State(string fleet, FleetInstance instance, string phase, string? error = null, string? session = null, long? started = null)
    { lock (gate) { var previous = states.GetValueOrDefault((fleet, instance.Key)); states[(fleet, instance.Key)] = new(instance, phase, session ?? previous?.SessionId, error, started, false, wanted.Contains((fleet, instance.Key)), previous?.LastActivityAt, previous?.HistoryAvailable); } }
    private bool Launched(string fleet, FleetConfiguration configuration, FleetInstance instance, RunningAgent runtime, CancellationToken cancellation, ActiveOperation? recovery = null)
    {
        var key = (fleet, instance.Key);
        lock (gate)
        {
            if (stopping || cancellation.IsCancellationRequested || !wanted.Contains(key) || running.ContainsKey(key) || recovery is not null && recovering.GetValueOrDefault(key) != recovery) return false;
            if (recovery is not null) recovering.Remove(key); running.Add(key, runtime); State(fleet, instance, "running", session: runtime.SessionId, started: Now); failures.GetValueOrDefault(key).Unregister(); failures.Remove(key);
        }
        var registration = runtime.Lifetime.Register(() =>
        {
            lock (gate) if (stopping || !wanted.Contains(key) || !running.TryGetValue(key, out var current) || !ReferenceEquals(current, runtime) || states.GetValueOrDefault(key)?.Phase != "running") return;
            _ = Recover(fleet, configuration, instance, new("unavailable", "Listener binding disconnected; recovering its exact saved identity and history"), runtime);
        });
        lock (gate)
        {
            if (!stopping && ReferenceEquals(running.GetValueOrDefault(key), runtime) && states.GetValueOrDefault(key)?.Phase == "running") failures[key] = registration;
            else registration.Unregister();
        }
        return true;
    }
    private Task Recover(string fleet, FleetConfiguration configuration, FleetInstance instance, Failure cause, RunningAgent? previous = null, bool immediately = false)
    {
        var key = (fleet, instance.Key); ActiveOperation operation; TaskCompletionSource completion; CancellationTokenSource stop; var attempted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (gate)
        {
            if (recovering.ContainsKey(key) || stopping) return Task.CompletedTask;
            if (previous is not null && (!ReferenceEquals(running.GetValueOrDefault(key), previous) || states.GetValueOrDefault(key)?.Phase != "running" || !wanted.Contains(key))) return Task.CompletedTask;
            State(fleet, instance, previous?.DeliberatelyStopped == true ? "stopping" : immediately ? "starting" : "failed", immediately ? null : cause.Message); stop = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token); completion = new(TaskCreationOptions.RunContinuationsAsynchronously); operation = new(stop, completion.Task); recovering.Add(key, operation);
        }
        _ = Run(); return attempted.Task;
        async Task Run()
        {
            try
            {
                if (previous?.DeliberatelyStopped == true)
                {
                    var saved = ChangeIntent(fleet, [instance.Key], false); await previous.DisposeAsync(); lock (gate) if (ReferenceEquals(running.GetValueOrDefault(key), previous)) running.Remove(key); State(fleet, instance, saved.IsSuccess ? "stopped" : "failed", saved.IsSuccess ? null : saved.Error.Message); return;
                }
                if (previous is not null) { await previous.DisposeAsync(); lock (gate) if (ReferenceEquals(running.GetValueOrDefault(key), previous)) running.Remove(key); }
                if (!Recoverable(cause)) return;
                for (var attempt = 0; !stop.IsCancellationRequested; attempt++)
                {
                    if (!immediately || attempt != 0) await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(60000, 1000 * (1 << Math.Min(attempt, 6)))), clock, stop.Token);
                    lock (gate) { if (stopping || !wanted.Contains(key)) return; if (active.ContainsKey(fleet) || mutations.Contains(fleet)) continue; }
                    await recoveryStarts.WaitAsync(stop.Token); Result<RunningAgent> result;
                    try { result = await execution.Start(configuration, instance, stop.Token, "recovery"); } finally { recoveryStarts.Release(); }
                    bool discard; lock (gate) discard = stop.IsCancellationRequested || stopping || !wanted.Contains(key);
                    if (!result.IsSuccess) { if (discard) return; State(fleet, instance, "failed", result.Error.Message); attempted.TrySetResult(); if (!Recoverable(result.Error)) return; continue; }
                    if (!Launched(fleet, configuration, instance, result.Value, stop.Token, operation)) await result.Value.DisposeAsync(); return;
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
            catch (Exception error) when (error is IOException or InvalidOperationException or InvalidDataException or AggregateException) { State(fleet, instance, "failed", "Native recovery cleanup failed; replacement is blocked: " + error.Message); }
            finally { lock (gate) if (recovering.GetValueOrDefault(key) == operation) recovering.Remove(key); attempted.TrySetResult(); completion.TrySetResult(); stop.Dispose(); }
        }
    }
    private static async ValueTask Cancel(ActiveOperation operation)
    { try { await operation.Stop.CancelAsync(); } catch (ObjectDisposedException) when (operation.Done.IsCompleted) { } }
    private static bool Recoverable(Failure error) => error.Code is "native" or "unavailable" or "body_too_large";
    private async Task StopInstance(string fleet, FleetInstance instance)
    {
        var key = (fleet, instance.Key); ActiveOperation? recovery; RunningAgent? runtime;
        lock (gate) { recovery = recovering.GetValueOrDefault(key); failures.GetValueOrDefault(key).Unregister(); failures.Remove(key); if (running.ContainsKey(key) || recovery is not null) State(fleet, instance, "stopping"); }
        if (recovery is not null) await Cancel(recovery);
        if (recovery is not null) await recovery.Done;
        lock (gate) { failures.GetValueOrDefault(key).Unregister(); failures.Remove(key); runtime = running.GetValueOrDefault(key); }
        if (runtime is not null) { await runtime.DisposeAsync(); lock (gate) if (ReferenceEquals(running.GetValueOrDefault(key), runtime)) running.Remove(key); } State(fleet, instance, "stopped");
    }
    private async Task Restore()
    {
        var tasks = new List<(FleetRegistration Record, FleetConfiguration Configuration, FleetInstance Instance)>();
        lock (gate)
        {
            foreach (var record in records)
            {
                var desired = wanted.Where(key => key.Fleet == record.FleetId).ToArray(); if (desired.Length == 0) continue; var configuration = registry.Load(record.Directory); if (!configuration.IsSuccess) { connectionErrors[record.Directory] = configuration.Error.Message; continue; }
                var valid = execution.Validate(configuration.Value); var configured = configuration.Value.Roster.Instances.Where(instance => wanted.Contains((record.FleetId, instance.Key))).ToArray();
                var error = configured.Length != desired.Length ? "Desired binding is missing from the saved roster; stop this fleet and review its files" : configuration.Value.Roster.Fleet != record.FleetKey || configuration.Value.Digest != record.Digest ? "Fleet files changed after their last accepted revision; review them and run an explicit update" : !valid.IsSuccess ? valid.Error.Message : null;
                if (error is not null) { connectionErrors[record.Directory] = error; foreach (var instance in configured) State(record.FleetId, instance, "failed", error); continue; } deployed[record.FleetId] = configuration.Value;
                foreach (var instance in configured) { State(record.FleetId, instance, "starting"); tasks.Add((record, configuration.Value, instance)); }
            }
        }
        try
        {
            await Task.WhenAll(tasks.Select(task => Recover(task.Record.FleetId, task.Configuration, task.Instance, new("unavailable", "Restoring the saved native identity and history"), immediately: true)));
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch (Exception error) when (error is IOException or InvalidOperationException or InvalidDataException) { lock (gate) foreach (var task in tasks) if (states.GetValueOrDefault((task.Record.FleetId, task.Instance.Key))?.Phase == "starting") State(task.Record.FleetId, task.Instance, "failed", error.Message); }
    }
    public Task Ready => restoration;
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task task; lock (gate) { if (closing is null) { stopping = true; completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } task = closing; } if (completion is not null) _ = Finish(completion); return new(task);
        async Task Finish(TaskCompletionSource result) { try { await Close(); result.TrySetResult(); } catch (Exception error) { result.TrySetException(error); } }
    }
    private async Task Close()
    {
        ActiveOperation[] work; Task mutationsDone; lock (gate) { work = active.Values.Concat(recovering.Values).ToArray(); mutationsDone = mutations.Count == 0 ? Task.CompletedTask : (mutationCompletion ??= new(TaskCreationOptions.RunContinuationsAsynchronously)).Task; }
        List<Exception> errors = []; async Task Finish(Func<Task> action) { try { await action(); } catch (Exception error) { errors.Add(error); } }
        foreach (var operation in work) await Finish(() => Cancel(operation).AsTask()); await Finish(lifetime.CancelAsync); await Finish(() => restoration); foreach (var operation in work) await Finish(() => operation.Done); await Finish(() => mutationsDone);
        RunningAgent[] agents; lock (gate) { foreach (var registration in failures.Values) registration.Unregister(); failures.Clear(); agents = running.Values.ToArray(); }
        foreach (var agent in agents) await Finish(() => agent.DisposeAsync().AsTask());
        lock (gate) running.Clear(); recoveryStarts.Dispose(); lifetime.Dispose(); if (errors.Count != 0) throw new AggregateException("Native shutdown requires inspection", errors);
    }
}
