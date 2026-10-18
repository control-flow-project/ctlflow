using System.Text.Json;
using Crossfire.AdapterCrossfire;
using Crossfire.AdapterFilesystem;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;
using Fleetd.Domain;
using Fleetd.Storage;

namespace Fleetd.AdapterExecution;

public sealed partial class ExecutionHost
{
    private sealed class InstanceExecution : RunningAgent
    {
        private readonly CancellationToken lifetimeToken;
        private readonly object gate = new();
        private readonly Func<Task> close;
        private Task? closing;
        public NativeLifecycle Native { get; }
        public string SessionId => Native.Runtime.SessionId;
        public CancellationToken Lifetime => lifetimeToken;
        public bool DeliberatelyStopped { get; internal set; }
        private ListenerControl Control { get; }
        public bool ListenerActive => Control.Current().Active;
        public InstanceExecution(NativeLifecycle native, CancellationToken lifetime, ListenerControl control, Func<Task> close) { Native = native; lifetimeToken = lifetime; Control = control; this.close = close; }
        public NativeSessionState NativeState() => Native.Current();
        public ValueTask<Result<Unit>> Resume() => Native.Resume();
        public ValueTask<Result<RuntimeAttachment>> Attachment(string? context = null) => Native.Attachment(context);
        public Result<IReadOnlyList<SavedRuntimeContext>> Contexts() => Native.Contexts();
        public ValueTask DisposeAsync()
        {
            TaskCompletionSource? completion = null; Task selected; lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; } if (completion is not null) _ = Finish(completion); return new(selected);
            async Task Finish(TaskCompletionSource result) { try { await close(); result.TrySetResult(); } catch (Exception error) { result.TrySetException(error); } }
        }
    }
    private ValueTask<Result<RunningAgent>> Start(FleetConfiguration configuration, FleetInstance instance, CancellationToken cancellation, string reason) => AgentIO.Boundary(async () =>
    {
        var loaded = BindingFiles.Load(configuration); if (!loaded.IsSuccess) return Result<RunningAgent>.Fail(loaded.Error); var binding = loaded.Value; var identity = binding.Identities.FirstOrDefault(identity => identity.InstanceKey == instance.Key); if (identity is null) return Results.Fail<RunningAgent>("missing", "Instance has no enrolled identity"); var connection = Find(configuration.Directory); if (connection is null) return Results.Fail<RunningAgent>("conflict", "Fleet controller connection is not initialized");
        var definition = configuration.Definitions[instance.Definition]; if (!adapters.TryGetValue(definition.Runtime, out var adapter)) return Results.Fail<RunningAgent>("invalid", "Unsupported native runtime: " + definition.Runtime); var validated = adapter.Validate(configuration.NativeOptions(instance)); if (!validated.IsSuccess) return Result<RunningAgent>.Fail(validated.Error);
        var stateDirectory = PrivateFiles.Directory(Path.Combine(configuration.Directory, instance.Workarea)); var workspace = instance.Workspace ?? stateDirectory; var protectedFiles = await ProjectFiles.Protect(stateDirectory, [".crossfire/"], cancellation); if (!protectedFiles.IsSuccess) return Result<RunningAgent>.Fail(protectedFiles.Error); var local = AgentProjects.Paths(stateDirectory, instance.Key); PrivateFiles.Directory(local.State);
        StateLock? owner = null; ListenerControl? control = null; NativeLifecycle? native = null; Task<Result<Unit>>? receiving = null; Task? observation = null, activation = null; StopActivity? activity = null; var stop = CancellationTokenSource.CreateLinkedTokenSource(cancellation); var transferred = false; var deliberatelyClosing = 0;
        async Task Close()
        {
            List<Exception> errors = []; async Task Finish(Func<Task> action) { try { await action(); } catch (Exception error) { errors.Add(error); } }
            Interlocked.Exchange(ref deliberatelyClosing, 1); var received = receiving; var observed = observation; var activated = activation; var ownedNative = native;
            var nativeClosed = ownedNative is null; if (ownedNative is not null) await Finish(async () => { await ownedNative.DisposeAsync(); nativeClosed = true; });
            await Finish(stop.CancelAsync);
            if (received is not null) await Finish(async () => { await received; }); if (observed is not null) await Finish(() => observed); if (activated is not null) await Finish(() => activated);
            if (nativeClosed && activity is { } reported) await Finish(() => { connection.Reports.Closed(reported); return Task.CompletedTask; });
            if (control is not null) await Finish(() => { connection.Control.Unbind(identity.AgentId); return Task.CompletedTask; });
            if (nativeClosed) await Finish(() => { owner?.Dispose(); return Task.CompletedTask; }); stop.Dispose(); if (errors.Count != 0) throw new AggregateException("Native instance shutdown requires inspection", errors);
        }
        try
        {
            var host = await Host(stop.Token); owner = new StateLock(Path.Combine(local.State, "listener"));
            var software = reason == "recovery" || PrivateFiles.Exists(Path.Combine(local.Root, "client.mjs")) ? AgentSoftware.Installed(local.Root) : AgentSoftware.Install(local.Root, artifacts); var client = Client(binding.Server, identity.Account.AccessToken); var health = await client.Call(new("health", new Dictionary<string, string>()), stop.Token); if (!health.IsSuccess) return Result<RunningAgent>.Fail(health.Error);
            var serverName = binding.Owner[(binding.Owner.IndexOf(':') + 1)..]; var profile = new AgentProfile(new(WireJson.Text(health.Value, "instance") ?? throw new InvalidDataException("Crossfire health lacks its instance identity"), binding.Server, serverName, binding.Owner, 16777216), stateDirectory, identity.AgentId, identity.Account); AgentIO.Write(AgentState.Port, local.Profile, AgentProfiles.Encode(profile)); software.Activate();
            var instructions = definition.Instructions + "\n\nCrossfire identity: " + instance.Name + ". This instance is already enrolled and its listener is managed by the fleet controller. Do not reconnect, enroll or start another listener.\n\nUse the intentional Crossfire tools from CROSSFIRE_PROJECT: node \"$CROSSFIRE_PROJECT/.crossfire/client.mjs\" --profile " + instance.Key + ". The profile is this instance's immutable local key, not its display name. Connection and telemetry require no model action. Never disclose host paths or private machine configuration outside the owner DM.\n\n" + InstanceReset.Instructions(local.State) + "\n\n" + software.Skill;
            control = connection.Control.Bind(identity.AgentId); var ready = new TaskCompletionSource<Result<Unit>>(TaskCreationOptions.RunContinuationsAsynchronously); var matrix = CoordinationTransport.Matrix(http, profile); var invitations = new AgentInvitations(matrix, identity.Account.UserId);
            var options = new ListenerOptions(profile, AgentState.Port, matrix, client, control, host.Budget, clock, local.Cursors, software.Release.Identity, async (hooks, lifetime) =>
            {
                var services = new NativeLifecycleServices(definition.Runtime, validated.Value.Approval, instance.HistoryMode == NativeHistoryMode.PerRoom ? "control" : "shared", reason == "operator" ? "running" : "sleeping", adapter.ConfiguredSettings(validated.Value.Options), hooks, new ResumeFiles(local.State, clock).Port,
                    () => adapter.SavedContexts(workspace, stateDirectory), async (observe, admission, runtimeStop) =>
                    {
                        var admitted = await host.Budget.Acquire(ListenerWork.NativeStart, admission?.Cancellation ?? runtimeStop, admission is not null); if (!admitted.IsSuccess) return Result<OwnedRuntimeConnection>.Fail(admitted.Error); using var lease = admitted.Value;
                        var opened = await RuntimeStartScope.Open(adapter, new(instance.Key, instance.Name, workspace, stateDirectory, instructions, configuration.NativeOptions(instance), hooks with { Observe = observe }, instance.HistoryMode, BindingFiles.CanInitialize(configuration.Directory, identity.AgentId)), admission, runtimeStop);
                        if (opened.IsSuccess) BindingFiles.Initialized(configuration.Directory, identity.AgentId); return opened;
                    }, (session, error) => { var reported = connection.Reports.Failure(identity.AgentId, session, error); if (!reported.IsSuccess) { log(reported.Error.Message); stop.Cancel(); } }, () => connection.Reports.Recovered(identity.AgentId), clock);
                var opened = await NativeLifecycle.Start(services, lifetime); if (!opened.IsSuccess) return Result<RuntimeConnection>.Fail(opened.Error); native = opened.Value; return Result<RuntimeConnection>.Success(native.Runtime);
            }, invitations.Read, log, instance.HistoryMode, PollMs: 10000, Activity: (run, generation) => activity = connection.Reports.Activity(identity.AgentId, run, generation, () => control.Binding()), Ready: (_, _) =>
            {
                activation = Activate(); async Task Activate() { if (native is null) { ready.TrySetResult(Results.Fail<Unit>("invalid", "Runtime did not report its session")); return; } var activated = await native.Activate(); ready.TrySetResult(activated); if (!activated.IsSuccess) stop.Cancel(); }
            });
            receiving = ListenerRunner.Run(options, host, "fleet-" + identity.AgentId, stop.Token).AsTask(); InstanceExecution? running = null;
            observation = Observe(); async Task Observe()
            {
                Result<Unit> ended; try { ended = await receiving; } catch (Exception error) { ended = Results.Fail<Unit>("unavailable", "Receiver task failed: " + error.Message); }
                if (!stop.IsCancellationRequested && Volatile.Read(ref deliberatelyClosing) == 0) { if (!ended.IsSuccess) connection.Reports.Failure(identity.AgentId, native?.Runtime.SessionId, ended.Error); else if (running is not null) running.DeliberatelyStopped = true; ready.TrySetResult(ended.IsSuccess ? Results.Fail<Unit>("conflict", "Listener disconnected by its local control") : ended); await stop.CancelAsync(); }
            }
            var readiness = await ready.Task.WaitAsync(stop.Token); if (!readiness.IsSuccess) return Result<RunningAgent>.Fail(readiness.Error); if (native is null) return Results.Fail<RunningAgent>("invalid", "Runtime did not report its session"); connection.Reports.Recovered(identity.AgentId);
            running = new(native, stop.Token, control, Close); transferred = true; return Result<RunningAgent>.Success(running);
        }
        catch (Exception error) when (error is IOException or InvalidDataException or InvalidOperationException or OperationCanceledException or JsonException or AggregateException)
        { if (!cancellation.IsCancellationRequested) connection.Reports.Failure(identity.AgentId, native?.Runtime.SessionId, new("unavailable", error.Message)); return Results.Fail<RunningAgent>("unavailable", "Instance startup failed: " + error.Message); }
        finally
        {
            if (!transferred) await Close();
        }
    });
    private async ValueTask<ListenerHost> Host(CancellationToken cancellation)
    {
        Task<ListenerHost> pending; lock (gate) pending = listenerHost ??= ListenerHost.Start(AgentState.Port, cancellation).AsTask();
        try { return await pending; } catch { lock (gate) if (ReferenceEquals(listenerHost, pending)) listenerHost = null; throw; }
    }
    private ValueTask<Result<Unit>> Test(FleetConfiguration configuration, FleetInstance instance, CancellationToken cancellation) => AgentIO.Boundary(async () =>
    {
        var local = AgentProjects.Paths(PrivateFiles.Directory(Path.Combine(configuration.Directory, instance.Workarea)), instance.Key); var result = await ListenerControlClient.Request(http, local.State, WireJson.Object(writer => writer.WriteString("action", "test")), cancellation); if (!result.IsSuccess) return Result<Unit>.Fail(result.Error); var value = result.Value;
        if (!value.TryGetProperty("ready", out var ready) || ready.ValueKind != JsonValueKind.True || !value.TryGetProperty("test", out var test) || WireJson.Text(test, "session") != WireJson.Text(value, "session") || WireJson.Text(test, "server") != configuration.Roster.Coordination.Server || !test.TryGetProperty("busy", out var busy) || busy.ValueKind != JsonValueKind.False || !test.TryGetProperty("deliveryPaused", out var paused) || paused.ValueKind != JsonValueKind.False) return Results.Fail<Unit>("conflict", "Listener authentication, exact native session or idle delivery readiness is not confirmed"); return Results.Done();
    });
}
