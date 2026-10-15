using System.Text.Json;
using Crossfire.AdapterCrossfire;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterHttp;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Domain;
using Fleetd.Storage;

namespace Fleetd.AdapterExecution;

public sealed partial class ExecutionHost : IAsyncDisposable
{
    private sealed record Connection(FleetBinding Binding, FleetConnection Control, FleetReports Reports);
    private readonly IReadOnlyDictionary<string, OwnedRuntimeAdapter> adapters;
    private readonly string artifacts;
    private readonly Action<string> log;
    private readonly TimeProvider clock;
    private readonly HttpClient http = NativeHttp.Client();
    private readonly Dictionary<string, Connection> connections = new(StringComparer.Ordinal);
    private readonly object gate = new();
    private Task<ListenerHost>? listenerHost;
    private Task? closing;
    public FleetExecution Port { get; }
    public ExecutionHost(IReadOnlyDictionary<string, OwnedRuntimeAdapter> adapters, string artifacts, Action<string> log, TimeProvider clock)
    {
        this.adapters = adapters; this.artifacts = artifacts; this.log = log; this.clock = clock;
        Port = new(Connect, Status, Delivery, Message, Disconnect, Validate, Inspect, Test, Prepare, Start, Contexts, ConfirmStopped, Reset, Remove, Archive, Update);
    }
    private Coordination Client(string server, string? token) => CoordinationTransport.Create(http, server, token);
    private Connection? Find(string directory) { lock (gate) return connections.GetValueOrDefault(directory); }
    private Result<Unit> Validate(FleetConfiguration configuration)
    {
        foreach (var definition in configuration.Definitions.Values) { if (!adapters.TryGetValue(definition.Runtime, out var adapter)) return Results.Fail<Unit>("invalid", "Unsupported native runtime: " + definition.Runtime); var parsed = adapter.Validate(definition.Options); if (!parsed.IsSuccess) return Result<Unit>.Fail(parsed.Error); }
        foreach (var instance in configuration.Roster.Instances) { var definition = configuration.Definitions[instance.Definition]; var parsed = adapters[definition.Runtime].Validate(configuration.NativeOptions(instance)); if (!parsed.IsSuccess) return Result<Unit>.Fail(parsed.Error with { Message = instance.Key + ": " + parsed.Error.Message }); } return Results.Done();
    }
    private ValueTask<Result<Unit>> Inspect(FleetConfiguration configuration, IReadOnlyList<FleetInstance> instances, CancellationToken cancellation) => AgentIO.Boundary(async () =>
    {
        var valid = Validate(configuration); if (!valid.IsSuccess) return valid; foreach (var instance in instances) { cancellation.ThrowIfCancellationRequested(); var definition = configuration.Definitions[instance.Definition]; var state = PrivateFiles.Directory(Path.Combine(configuration.Directory, instance.Workarea)); var inspected = await adapters[definition.Runtime].Inspect(new(instance.Workspace ?? state, state, configuration.NativeOptions(instance)), cancellation); if (!inspected.IsSuccess) return inspected; } return Results.Done();
    });
    private Result<Unit> Connect(FleetConfiguration configuration, CancellationToken stop, Func<OperationRequest, ValueTask<Result<FleetOperation>>> execute, Func<string, Result<Unit>> acknowledged) => ConfigurationFiles.Boundary(() =>
    {
        var loaded = BindingFiles.Load(configuration); if (!loaded.IsSuccess) return Result<Unit>.Fail(loaded.Error); var binding = loaded.Value; if (binding.FleetId is null || binding.ControllerCredential is null) return Results.Done();
        if (binding.Server != configuration.Roster.Coordination.Server || binding.Owner != configuration.Roster.Coordination.Owner || binding.FleetKey != configuration.Roster.Fleet) return Results.Fail<Unit>("conflict", "Fleet binding does not match its coordination configuration");
        lock (gate)
        {
            if (connections.ContainsKey(configuration.Directory)) return Results.Done(); var coordination = Client(binding.Server, binding.ControllerCredential); FleetConnection? control = null;
            var reports = new FleetReports(AgentState.Port, configuration.Directory, binding.FleetId, coordination, clock, () => control?.Status.Connected == true, stop);
            control = new(coordination, binding.FleetId, binding.ControllerCredential, binding.Owner, clock, async (command, cancellation) =>
            {
                var current = BindingFiles.Load(configuration); if (!current.IsSuccess) return Result<RemoteRuntimeOutcome>.Fail(current.Error); if (WireJson.Text(command, "fleetId") != current.Value.FleetId) return Results.Fail<RemoteRuntimeOutcome>("conflict", "Session command is not for this enrolled fleet");
                var agent = WireJson.Text(command, "agentId"); var identity = agent is null ? null : current.Value.Identities.FirstOrDefault(value => value.AgentId == agent); if (agent is not null && identity is null) return Results.Fail<RemoteRuntimeOutcome>("missing", "Requested agent has no identity in this controller binding");
                var action = WireJson.Text(command, "action"); var id = WireJson.Text(command, "operationId"); if (id is null || !Validation.Identifier(id) || action is not ("start" or "stop" or "reset")) return Results.Fail<RemoteRuntimeOutcome>("invalid", "Invalid controller native command");
                var result = await execute(new(id, new(identity is null ? "fleet" : "agent", null, identity?.InstanceKey), action, 0)); return result.Map(operation => new RemoteRuntimeOutcome(operation.Status == "succeeded" ? "succeeded" : "failed", operation.Status == "succeeded" ? null : string.Join("; ", operation.Errors.Select(error => (error.InstanceKey is null ? "" : error.InstanceKey + ": ") + error.Message))));
            }, acknowledged, stop);
            connections.Add(configuration.Directory, new(binding, control, reports));
        }
        return Results.Done();
    });
    private FleetConnectionState Status(FleetConfiguration configuration)
    { var connection = Find(configuration.Directory); var current = connection?.Control.Status; return current is null ? new(false, false, null, "Fleet has no approved controller binding") : new(current.Connected, current.DeliveryEnabled, current.Revision, connection!.Reports.Error ?? current.Error); }
    private ValueTask<Result<JsonElement>> Delivery(FleetConfiguration configuration, long revision, bool enabled, CancellationToken cancellation) => Find(configuration.Directory)?.Control.Delivery(revision, enabled, cancellation) ?? ValueTask.FromResult(Results.Fail<JsonElement>("conflict", "Enroll this fleet before changing its delivery"));
    private ValueTask<Result<JsonElement>> Message(FleetConfiguration configuration, string id, string body, CancellationToken cancellation) => Find(configuration.Directory)?.Control.Message(id, body, cancellation) ?? ValueTask.FromResult(Results.Fail<JsonElement>("conflict", "Enroll this fleet before sending messages"));
    private async ValueTask Disconnect(FleetConfiguration configuration)
    { Connection? connection; lock (gate) { connection = connections.GetValueOrDefault(configuration.Directory); connections.Remove(configuration.Directory); } if (connection is not null) { try { await connection.Reports.DisposeAsync(); } finally { await connection.Control.DisposeAsync(); } } }
    private ValueTask<Result<Unit>> Prepare(FleetConfiguration configuration, ControllerIdentity controller, string intent, CancellationToken cancellation, Action<ApprovalLink> approval) => AgentIO.Boundary(async () =>
    {
        var inspected = await Inspect(configuration, configuration.Roster.Instances, cancellation); if (!inspected.IsSuccess) return inspected; var protectedFiles = await ProjectFiles.Protect(configuration.Directory, [".fleet/", "**/workarea/"], cancellation); if (!protectedFiles.IsSuccess) return protectedFiles;
        return await Enrollment.Prepare(configuration, controller, intent, token => Client(configuration.Roster.Coordination.Server, token), clock, approval, cancellation);
    });
    private Result<IReadOnlyList<SavedRuntimeContext>> Contexts(FleetConfiguration configuration, FleetInstance instance) => ConfigurationFiles.Boundary<IReadOnlyList<SavedRuntimeContext>>(() =>
    {
        var definition = configuration.Definitions[instance.Definition]; if (!adapters.TryGetValue(definition.Runtime, out var adapter)) return Results.Fail<IReadOnlyList<SavedRuntimeContext>>("invalid", "Unsupported native runtime: " + definition.Runtime); var state = Path.Combine(configuration.Directory, instance.Workarea); return PrivateFiles.Exists(state) ? adapter.SavedContexts(instance.Workspace ?? state, state) : Result<IReadOnlyList<SavedRuntimeContext>>.Success([]);
    });
    private ValueTask<Result<Unit>> ConfirmStopped(FleetConfiguration configuration, FleetInstance instance, CancellationToken cancellation)
    { var loaded = BindingFiles.Load(configuration); if (!loaded.IsSuccess) return ValueTask.FromResult(Result<Unit>.Fail(loaded.Error)); var identity = loaded.Value.Identities.FirstOrDefault(identity => identity.InstanceKey == instance.Key); return identity is null ? ValueTask.FromResult(Results.Done()) : Find(configuration.Directory)?.Reports.Confirm(identity.AgentId, cancellation) ?? ValueTask.FromResult(Results.Done()); }
    private ValueTask<Result<Unit>> Reset(FleetConfiguration configuration, FleetInstance instance, string id, CancellationToken cancellation) => AgentIO.Boundary(async () =>
    {
        var inspected = await Inspect(configuration, [instance], cancellation); if (!inspected.IsSuccess) return inspected; var loaded = BindingFiles.Load(configuration); if (!loaded.IsSuccess) return Result<Unit>.Fail(loaded.Error); var identity = loaded.Value.Identities.FirstOrDefault(identity => identity.InstanceKey == instance.Key); if (identity is null) return Results.Fail<Unit>("missing", "Instance has no enrolled identity");
        var local = AgentProjects.Paths(PrivateFiles.Directory(Path.Combine(configuration.Directory, instance.Workarea)), instance.Key); var profile = AgentProfiles.Parse(AgentIO.Read(AgentState.Port, local.Profile)); if (!profile.IsSuccess) return Result<Unit>.Fail(profile.Error);
        return await InstanceReset.Run(configuration, instance, identity.AgentId, id, adapters[configuration.Definitions[instance.Definition].Runtime], CoordinationTransport.Matrix(http, profile.Value), Client(loaded.Value.Server, identity.Account.AccessToken), clock, cancellation);
    });
    private ValueTask<Result<Unit>> Update(FleetConfiguration configuration, FleetInstance instance, string releaseDirectory, CancellationToken cancellation) => AgentIO.Boundary(() =>
    {
        cancellation.ThrowIfCancellationRequested(); var local = AgentProjects.Paths(PrivateFiles.Directory(Path.Combine(configuration.Directory, instance.Workarea)), instance.Key); using var listener = new StateLock(Path.Combine(local.State, "listener")); using var receiver = new StateLock(Path.Combine(local.State, "receiver")); var software = AgentSoftware.Install(local.Root, releaseDirectory); cancellation.ThrowIfCancellationRequested(); software.Activate(); return ValueTask.FromResult(Results.Done());
    });
    private ValueTask<Result<Unit>> Remove(FleetConfiguration configuration, FleetInstance instance, CancellationToken cancellation) => AgentIO.Boundary(async () =>
    {
        var loaded = BindingFiles.Load(configuration); if (!loaded.IsSuccess) return Result<Unit>.Fail(loaded.Error); var binding = loaded.Value; var identity = binding.Identities.FirstOrDefault(identity => identity.InstanceKey == instance.Key); if (identity is null) return Results.Done(); var confirmed = await ConfirmStopped(configuration, instance, cancellation); if (!confirmed.IsSuccess) return confirmed;
        if (binding.FleetId is null || binding.ControllerCredential is null) return Results.Fail<Unit>("forbidden", "Fleet controller credential is missing"); var client = Client(binding.Server, binding.ControllerCredential); var current = await client.Call(new("fleet", new Dictionary<string, string> { ["fleetId"] = binding.FleetId }), cancellation); if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
        var removed = await client.Call(new("removeFleetAgent", new Dictionary<string, string> { ["fleetId"] = binding.FleetId, ["agentId"] = identity.AgentId }, WireJson.Object(writer => { writer.WriteNumber("expectedRevision", current.Value.GetProperty("revision").GetInt64()); writer.WriteString("instanceKey", instance.Key); })), cancellation); if (!removed.IsSuccess) return Result<Unit>.Fail(removed.Error); Find(configuration.Directory)?.Reports.Forget(identity.AgentId); return BindingFiles.Save(configuration.Directory, binding with { Request = null });
    });
    private ValueTask<Result<Unit>> Archive(FleetConfiguration configuration, CancellationToken cancellation) => AgentIO.Boundary(async () =>
    {
        foreach (var instance in configuration.Roster.Instances) { var confirmed = await ConfirmStopped(configuration, instance, cancellation); if (!confirmed.IsSuccess) return confirmed; } var loaded = BindingFiles.Load(configuration); if (!loaded.IsSuccess) return Result<Unit>.Fail(loaded.Error); var binding = loaded.Value; if (binding.FleetId is null) return Results.Done(); if (binding.ControllerCredential is null) return Results.Fail<Unit>("forbidden", "Fleet controller credential is missing");
        var client = Client(binding.Server, binding.ControllerCredential); var current = await client.Call(new("fleet", new Dictionary<string, string> { ["fleetId"] = binding.FleetId }), cancellation); if (!current.IsSuccess) return Result<Unit>.Fail(current.Error); return (await client.Call(new("archiveFleet", new Dictionary<string, string> { ["fleetId"] = binding.FleetId }, WireJson.Object(writer => writer.WriteNumber("expectedRevision", current.Value.GetProperty("revision").GetInt64()))), cancellation)).Map(_ => default(Unit));
    });
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected; lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; } if (completion is not null) _ = Finish(completion); return new(selected);
        async Task Finish(TaskCompletionSource result) { try { await Close(); result.TrySetResult(); } catch (Exception error) { result.TrySetException(error); } }
    }
    private async Task Close()
    {
        Connection[] selected; Task<ListenerHost>? host; lock (gate) { selected = connections.Values.ToArray(); connections.Clear(); host = listenerHost; }
        List<Exception> errors = []; async Task Finish(Func<Task> action) { try { await action(); } catch (Exception error) { errors.Add(error); } }
        foreach (var connection in selected) { await Finish(() => connection.Reports.DisposeAsync().AsTask()); await Finish(() => connection.Control.DisposeAsync().AsTask()); } if (host is not null) await Finish(async () => await (await host).DisposeAsync()); http.Dispose(); if (errors.Count != 0) throw new AggregateException("Controller transport shutdown requires inspection", errors);
    }
}
