using Crossfire.Kernel;

namespace Fleetd.Domain;

public sealed partial class FleetController
{
    public async ValueTask<Result<FleetOperation>> Operate(OperationRequest request, bool receiptPending = false)
    {
        if (!IdentitySyntax.Identifier(request.OperationId) || request.Action is not ("enroll" or "start" or "stop" or "reset" or "update") || (request.Action == "update") != (request.ReleaseDirectory is not null)) return Results.Fail<FleetOperation>("invalid", "Invalid lifecycle operation identity, action or explicit software directory");
        if (request.Target.Kind == "daemon")
        {
            if (request.Action != "stop" || request.ExpectedRevision != 0 || request.Target.FleetId is not null || request.Target.InstanceKey is not null) return Results.Fail<FleetOperation>("invalid", "Daemon supports only an exact stop request"); var previous = registry.Operation(request.OperationId); if (!previous.IsSuccess) return Result<FleetOperation>.Fail(previous.Error); if (previous.Value is not null) return previous.Value.Request == request ? Result<FleetOperation>.Success(previous.Value) : Results.Fail<FleetOperation>("conflict", "Operation ID was used for a different request");
            var operation = new FleetOperation(request, "running", Now, null, null, []); var saved = registry.SaveOperation(operation); if (!saved.IsSuccess) return Result<FleetOperation>.Fail(saved.Error); await DisposeAsync(); operation = operation with { Status = "succeeded", CompletedAt = Now }; saved = registry.SaveOperation(operation); return saved.Map(_ => operation);
        }
        FleetOperation accepted; FleetConfiguration? configuration; IReadOnlyList<FleetInstance> selected; ActiveOperation? predecessor; ActiveOperation work; TaskCompletionSource completed;
        lock (gate)
        {
            var previous = registry.Operation(request.OperationId); if (!previous.IsSuccess) return Result<FleetOperation>.Fail(previous.Error); if (previous.Value is not null) return previous.Value.Request == request ? Result<FleetOperation>.Success(previous.Value) : Results.Fail<FleetOperation>("conflict", "Operation ID was used for a different request");
            if (stopping) return Results.Fail<FleetOperation>("unavailable", "Controller is stopping"); var target = request.Target; if (target.Kind is not ("fleet" or "agent") || target.FleetId is null || !IdentitySyntax.Identifier(target.FleetId) || (target.Kind == "agent") != (target.InstanceKey is not null)) return Results.Fail<FleetOperation>("invalid", "Invalid lifecycle target");
            var fleet = target.FleetId; if (mutations.Contains(fleet)) return Results.Fail<FleetOperation>("conflict", "A roster change is in progress"); var record = records.FirstOrDefault(record => record.FleetId == fleet); if (record is null) return Results.Fail<FleetOperation>("missing", "Fleet is not registered"); if (record.Revision != request.ExpectedRevision) return Results.Fail<FleetOperation>("stale_revision", "Refresh the fleet before starting this operation"); if (request.Action == "enroll" && (target.Kind != "fleet" || Executing(fleet))) return Results.Fail<FleetOperation>("conflict", "Enrollment without startup requires a stopped whole fleet");
            if (request.Action == "stop") { var loaded = deployed.TryGetValue(fleet, out var activeConfiguration) ? Result<FleetConfiguration>.Success(activeConfiguration) : registry.Load(record.Directory); configuration = loaded.IsSuccess ? loaded.Value : null; }
            else { var inspected = Inspect(fleet); if (!inspected.IsSuccess) return Result<FleetOperation>.Fail(inspected.Error); configuration = inspected.Value.Configuration; }
            var catalog = (configuration?.Roster.Instances ?? []).ToDictionary(instance => instance.Key, StringComparer.Ordinal); if (request.Action == "stop") foreach (var state in states.Where(value => value.Key.Fleet == fleet)) catalog[state.Value.Instance.Key] = state.Value.Instance;
            var enabled = wanted.Where(key => key.Fleet == fleet).Select(key => key.Instance).ToArray();
            if (target.Kind == "fleet" && request.Action == "start" && (selections.TryGetValue(fleet, out var paused) || enabled.Length != 0))
            { var keys = (paused ?? []).Concat(enabled).ToHashSet(StringComparer.Ordinal); if (keys.Any(key => !catalog.ContainsKey(key))) return Results.Fail<FleetOperation>("conflict", "A saved resume target is missing from the current roster; review the fleet"); selected = catalog.Values.Where(instance => keys.Contains(instance.Key)).ToArray(); }
            else selected = catalog.Values.Where(instance => target.Kind != "agent" || instance.Key == target.InstanceKey).ToArray();
            if (target.Kind == "agent" && selected.Count == 0 && !wanted.Contains((fleet, target.InstanceKey!))) return Results.Fail<FleetOperation>("missing", "Instance not found"); if (request.Action == "start" && catalog.Count == 0) return Results.Fail<FleetOperation>("invalid", "Add an instance before starting this fleet");
            if (request.Action != "stop" && selected.Any(instance => running.TryGetValue((fleet, instance.Key), out var runtime) && (runtime.Lifetime.IsCancellationRequested || states.GetValueOrDefault((fleet, instance.Key))?.Phase == "failed"))) return Results.Fail<FleetOperation>("conflict", "Runtime failure cleanup is still in progress; retry after it finishes");
            predecessor = active.GetValueOrDefault(fleet); if (predecessor is not null && request.Action != "stop") return Results.Fail<FleetOperation>("conflict", "Another operation is active for this fleet"); accepted = new(request, "accepted", Now, null, null, [], receiptPending); var stored = registry.SaveOperation(accepted); if (!stored.IsSuccess) return Result<FleetOperation>.Fail(stored.Error);
            if (request.Action is "stop" or "reset")
            {
                var checkpoint = request.Action == "stop" ? SaveSelection(fleet, enabled, target.InstanceKey) : Results.Done(); if (checkpoint.IsSuccess) checkpoint = ChangeIntent(fleet, selected.Select(instance => instance.Key).Concat(enabled.Where(key => target.Kind != "agent" || key == target.InstanceKey)).Distinct(StringComparer.Ordinal).ToArray(), false);
                if (!checkpoint.IsSuccess) { registry.SaveOperation(accepted with { Status = "failed", CompletedAt = Now, Errors = [new(null, checkpoint.Error.Code, checkpoint.Error.Message)] }); return Result<FleetOperation>.Fail(checkpoint.Error); }
            }
            if (request.Action != "stop" && configuration is not null && configuration.Digest != record.Digest)
            {
                var valid = execution.Validate(configuration); if (valid.IsSuccess) valid = Persist(records.Select(row => row.FleetId == fleet ? row with { Digest = configuration.Digest, Revision = checked(row.Revision + 1) } : row).ToArray());
                if (!valid.IsSuccess) { registry.SaveOperation(accepted with { Status = "failed", CompletedAt = Now, Errors = [new(null, valid.Error.Code, valid.Error.Message)] }); return Result<FleetOperation>.Fail(valid.Error); }
            }
            var stop = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token); completed = new(TaskCreationOptions.RunContinuationsAsynchronously); work = new(stop, completed.Task); active[fleet] = work; if (configuration is not null) deployed[fleet] = configuration;
        }
        if (predecessor is not null) await Cancel(predecessor);
        _ = Run(); return Result<FleetOperation>.Success(accepted);
        async Task Run()
        {
            FleetOperation outcome;
            try { if (predecessor is not null) await predecessor.Done; outcome = await Execute(accepted, configuration, selected, work.Stop.Token); }
            catch (Exception error)
            {
                foreach (var instance in selected) { try { await StopInstance(request.Target.FleetId!, instance); } catch (Exception) { await lifetime.CancelAsync(); } }
                outcome = accepted with { Status = "failed", CompletedAt = Now, Approval = null, Errors = [new(null, "unavailable", error.Message)] };
            }
            try
            {
                lock (gate)
                {
                    if (active.GetValueOrDefault(request.Target.FleetId!) == work) active.Remove(request.Target.FleetId!);
                    Save(outcome);
                }
            }
            catch (IOException) { lock (gate) stopping = true; await lifetime.CancelAsync(); }
            finally { completed.TrySetResult(); work.Stop.Dispose(); }
        }
    }
    private async Task<FleetOperation> Execute(FleetOperation initial, FleetConfiguration? configuration, IReadOnlyList<FleetInstance> selected, CancellationToken cancellation)
    {
        var operation = initial with { Status = "running" }; Save(operation); var errors = new List<OperationError>(); var fleet = operation.Request.Target.FleetId!; var action = operation.Request.Action;
        void Error(FleetInstance? instance, Failure failure) { errors.Add(new(instance?.Key, failure.Code, failure.Message)); if (instance is not null) State(fleet, instance, "failed", failure.Message); }
        async ValueTask Stop(IReadOnlyList<FleetInstance> instances) { foreach (var instance in instances) { try { await StopInstance(fleet, instance); } catch (Exception error) when (error is IOException or InvalidOperationException or OperationCanceledException or AggregateException) { Error(instance, new("unavailable", "Native cleanup failed: " + error.Message)); } } }
        async Task Apply()
        {
            if (action == "stop")
            {
                await Stop(selected); if (configuration is not null) foreach (var instance in selected.Where(instance => errors.All(error => error.InstanceKey != instance.Key))) { var confirmed = await execution.ConfirmStopped(configuration, instance, cancellation); if (!confirmed.IsSuccess) Error(instance, confirmed.Error); } return;
            }
            if (configuration is null) { Error(null, new("invalid", "Starting or updating requires a validated fleet configuration")); return; }
            if (action == "update")
            {
                FleetInstance[] enabled; lock (gate) enabled = selected.Where(instance => wanted.Contains((fleet, instance.Key))).ToArray(); await Stop(selected);
                foreach (var instance in selected) { cancellation.ThrowIfCancellationRequested(); if (errors.Any(error => error.InstanceKey == instance.Key)) continue; var updated = await execution.Update(configuration, instance, operation.Request.ReleaseDirectory!, cancellation); if (!updated.IsSuccess) Error(instance, updated.Error); }
                Connect(configuration); foreach (var instance in enabled) { lock (gate) if (!wanted.Contains((fleet, instance.Key))) continue; if (errors.Any(error => error.InstanceKey == instance.Key)) continue; var opened = await execution.Start(configuration, instance, cancellation, "operator"); if (!opened.IsSuccess) Error(instance, opened.Error); else if (!Launched(fleet, configuration, instance, opened.Value, cancellation)) await opened.Value.DisposeAsync(); } return;
            }
            if (action == "start" && selected.Count == 0) return; var valid = execution.Validate(configuration); if (!valid.IsSuccess) { Error(null, valid.Error); return; }
            FleetInstance[] recoveringInstances; lock (gate) recoveringInstances = selected.Where(instance => recovering.ContainsKey((fleet, instance.Key))).ToArray(); await Stop(recoveringInstances);
            if (action == "reset")
            {
                var inspected = await execution.Inspect(configuration, selected, cancellation); if (!inspected.IsSuccess) { Error(null, inspected.Error); return; } await Stop(selected.Where(instance => errors.All(error => error.InstanceKey != instance.Key)).ToArray());
                foreach (var instance in selected) { if (errors.Any(error => error.InstanceKey == instance.Key)) continue; var reset = await execution.Reset(configuration, instance, operation.Request.OperationId, cancellation); if (!reset.IsSuccess) Error(instance, reset.Error); }
            }
            foreach (var instance in selected) { lock (gate) if (!running.ContainsKey((fleet, instance.Key)) && errors.All(error => error.InstanceKey != instance.Key)) State(fleet, instance, "starting"); }
            var prepared = await execution.Prepare(configuration, controller, action == "enroll" ? "enroll" : "resume", cancellation, approval =>
            { operation = operation with { Status = "awaiting-approval", Approval = approval }; Save(operation); lock (gate) foreach (var instance in selected) if (!running.ContainsKey((fleet, instance.Key)) && errors.All(error => error.InstanceKey != instance.Key)) State(fleet, instance, "awaiting-approval"); });
            if (!prepared.IsSuccess) { Error(null, prepared.Error); return; } cancellation.ThrowIfCancellationRequested(); Connect(configuration); lock (gate) if (connectionErrors.TryGetValue(configuration.Directory, out var error)) { Error(null, new("unavailable", error)); return; }
            operation = operation with { Status = "running", Approval = null }; Save(operation);
            if (action == "enroll") { foreach (var instance in selected) State(fleet, instance, errors.Any(error => error.InstanceKey == instance.Key) ? "failed" : "stopped", errors.FirstOrDefault(error => error.InstanceKey == instance.Key)?.Message); return; }
            var desired = ChangeIntent(fleet, selected.Where(instance => errors.All(error => error.InstanceKey != instance.Key)).Select(instance => instance.Key).ToArray(), true); if (!desired.IsSuccess) { Error(null, desired.Error); return; }
            foreach (var instance in selected)
            {
                cancellation.ThrowIfCancellationRequested(); if (errors.Any(error => error.InstanceKey == instance.Key)) continue; RunningAgent? current; lock (gate) current = running.GetValueOrDefault((fleet, instance.Key));
                if (current is not null) { var resumed = await current.Resume(); if (!resumed.IsSuccess) Error(instance, resumed.Error); continue; }
                var started = await execution.Start(configuration, instance, cancellation, "operator"); bool discard; lock (gate) discard = cancellation.IsCancellationRequested || !wanted.Contains((fleet, instance.Key)); if (discard) { if (started.IsSuccess) await started.Value.DisposeAsync(); cancellation.ThrowIfCancellationRequested(); continue; }
                if (!started.IsSuccess) Error(instance, started.Error); else if (!Launched(fleet, configuration, instance, started.Value, cancellation)) await started.Value.DisposeAsync();
            }
        }
        try { await Apply(); }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { Error(null, new("unavailable", "Native operation was cancelled by controller shutdown or explicit stop")); }
        catch (Exception error) when (error is IOException or InvalidDataException or InvalidOperationException) { Error(null, new("unavailable", error.Message)); }
        finally
        {
            if (cancellation.IsCancellationRequested && action != "stop") await Stop(selected);
            lock (gate) foreach (var instance in selected) if (states.GetValueOrDefault((fleet, instance.Key))?.Phase is "starting" or "awaiting-approval") State(fleet, instance, "failed", errors.FirstOrDefault()?.Message ?? "Operation did not complete");
            if (errors.Count == 0 && action == "start") { var marked = registry.CompleteSetup(operation.Request.OperationId); if (!marked.IsSuccess) Error(null, marked.Error); }
        }
        return operation with { Status = errors.Count == 0 ? "succeeded" : "failed", CompletedAt = Now, Approval = null, Errors = errors };
    }
    private void Save(FleetOperation operation) { var result = registry.SaveOperation(operation); if (!result.IsSuccess) throw new IOException("Operation persistence failed: " + result.Error.Message); }
}
