using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Kernel;

namespace Fleetd.Domain;

public sealed partial class FleetController : IAsyncDisposable
{
    private sealed record ActiveOperation(CancellationTokenSource Stop, Task Done);
    private readonly FleetRegistry registry;
    private readonly FleetExecution execution;
    private readonly ControllerIdentity controller;
    private readonly TimeProvider clock;
    private readonly object gate = new();
    private readonly CancellationTokenSource lifetime = new();
    private readonly SemaphoreSlim recoveryStarts = new(4, 4);
    private IReadOnlyList<FleetRegistration> records;
    private readonly Dictionary<string, FleetConfiguration> deployed = new(StringComparer.Ordinal);
    private readonly Dictionary<(string Fleet, string Instance), InstanceState> states = [];
    private readonly Dictionary<(string Fleet, string Instance), RunningAgent> running = [];
    private readonly Dictionary<(string Fleet, string Instance), CancellationTokenRegistration> failures = [];
    private readonly HashSet<(string Fleet, string Instance)> wanted = [];
    private readonly Dictionary<string, IReadOnlyList<string>> selections = new(StringComparer.Ordinal);
    private readonly Dictionary<string, ActiveOperation> active = new(StringComparer.Ordinal);
    private readonly Dictionary<(string Fleet, string Instance), ActiveOperation> recovering = [];
    private readonly HashSet<string> mutations = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> connectionErrors = new(StringComparer.Ordinal);
    private Task restoration = Task.CompletedTask;
    private bool stopping;
    private Task? closing;
    private TaskCompletionSource? mutationCompletion;
    public long StartedAt { get; }
    public bool Stopping { get { lock (gate) return stopping; } }
    public ControllerIdentity Identity => controller;
    private long Now => clock.GetUtcNow().ToUnixTimeMilliseconds();
    private FleetController(FleetRegistry registry, FleetExecution execution, ControllerIdentity controller, TimeProvider clock, IReadOnlyList<FleetRegistration> records)
    { this.registry = registry; this.execution = execution; this.controller = controller; this.clock = clock; this.records = records; StartedAt = Now; }
    public static Result<FleetController> Create(FleetRegistry registry, FleetExecution execution, ControllerIdentity controller, TimeProvider clock)
    {
        var records = registry.Registrations(); if (!records.IsSuccess) return Result<FleetController>.Fail(records.Error); var desired = registry.Desired(); if (!desired.IsSuccess) return Result<FleetController>.Fail(desired.Error); var selections = registry.Selections(); if (!selections.IsSuccess) return Result<FleetController>.Fail(selections.Error); var pending = registry.PendingOperations(); if (!pending.IsSuccess) return Result<FleetController>.Fail(pending.Error);
        if (desired.Value.Any(value => !records.Value.Any(record => record.FleetId == value.FleetId)) || selections.Value.Any(value => !records.Value.Any(record => record.FleetId == value.FleetId))) return Results.Fail<FleetController>("invalid", "Saved desired bindings or resume selections reference an unregistered fleet");
        var value = new FleetController(registry, execution, controller, clock, records.Value); foreach (var row in desired.Value) value.wanted.Add((row.FleetId, row.InstanceKey)); foreach (var row in selections.Value) value.selections[row.FleetId] = row.InstanceKeys;
        foreach (var operation in pending.Value.Where(operation => operation.CompletedAt is null))
        {
            if (operation.Request.Action is "stop" or "reset" && operation.Request.Target.FleetId is { } fleet)
            { var enabled = value.wanted.Where(row => row.Fleet == fleet && (operation.Request.Target.InstanceKey is null || row.Instance == operation.Request.Target.InstanceKey)).Select(row => row.Instance).ToArray(); if (operation.Request.Action == "stop") { var saved = value.SaveSelection(fleet, enabled, operation.Request.Target.InstanceKey); if (!saved.IsSuccess) return Result<FleetController>.Fail(saved.Error); } var savedIntent = value.ChangeIntent(fleet, enabled, false); if (!savedIntent.IsSuccess) return Result<FleetController>.Fail(savedIntent.Error); }
            var savedOperation = registry.SaveOperation(operation with { Status = "failed", CompletedAt = value.Now, Approval = null, Errors = [new(null, "unavailable", "Controller stopped before this operation completed; inspect and retry explicitly")] }); if (!savedOperation.IsSuccess) return Result<FleetController>.Fail(savedOperation.Error);
        }
        foreach (var record in records.Value) { var configuration = registry.Load(record.Directory); if (configuration.IsSuccess) value.Connect(configuration.Value); else value.connectionErrors[record.Directory] = configuration.Error.Message; }
        value.restoration = value.Restore(); return Result<FleetController>.Success(value);
    }
    private void Connect(FleetConfiguration configuration)
    {
        var result = execution.Connect(configuration, lifetime.Token, async request =>
        {
            FleetRegistration? record; lock (gate) record = records.FirstOrDefault(record => record.Directory == configuration.Directory); if (record is null) return Results.Fail<FleetOperation>("missing", "This fleet is no longer registered");
            var previous = registry.Operation(request.OperationId); if (!previous.IsSuccess) return Result<FleetOperation>.Fail(previous.Error);
            var input = request with { Target = request.Target with { FleetId = record.FleetId }, ExpectedRevision = previous.Value?.Request.ExpectedRevision ?? record.Revision }; var accepted = await Operate(input, true); if (!accepted.IsSuccess) return accepted;
            Task? completion; lock (gate) completion = active.GetValueOrDefault(record.FleetId)?.Done; if (accepted.Value.CompletedAt is null && completion is not null) await completion; var completed = registry.Operation(request.OperationId);
            return completed.IsSuccess && completed.Value is not null && completed.Value.CompletedAt is not null ? Result<FleetOperation>.Success(completed.Value) : completed.IsSuccess ? Results.Fail<FleetOperation>("unavailable", "The native session operation did not complete") : Result<FleetOperation>.Fail(completed.Error);
        }, AcknowledgeOperation);
        lock (gate) { if (result.IsSuccess) connectionErrors.Remove(configuration.Directory); else connectionErrors[configuration.Directory] = result.Error.Message; }
    }
    private Result<Unit> Persist(IReadOnlyList<FleetRegistration> next) { var result = registry.SaveRegistrations(next); if (result.IsSuccess) records = next; return result; }
    private bool Executing(string fleet) => active.ContainsKey(fleet) || running.Keys.Any(key => key.Fleet == fleet) || wanted.Any(key => key.Fleet == fleet);
    private Result<(FleetRegistration Record, FleetConfiguration Configuration)> Inspect(string fleet)
    {
        var record = records.FirstOrDefault(record => record.FleetId == fleet); if (record is null) return Results.Fail<(FleetRegistration, FleetConfiguration)>("missing", "Fleet is not registered");
        var configuration = deployed.TryGetValue(fleet, out var activeConfiguration) && Executing(fleet) ? Result<FleetConfiguration>.Success(activeConfiguration) : registry.Load(record.Directory); if (!configuration.IsSuccess) return Result<(FleetRegistration, FleetConfiguration)>.Fail(configuration.Error);
        return configuration.Value.Roster.Fleet == record.FleetKey ? Result<(FleetRegistration, FleetConfiguration)>.Success((record, configuration.Value)) : Results.Fail<(FleetRegistration, FleetConfiguration)>("conflict", "A registered fleet key cannot change");
    }
    public Result<FleetState> View(string fleet)
    {
        lock (gate)
        {
            var inspected = Inspect(fleet); if (!inspected.IsSuccess) return Result<FleetState>.Fail(inspected.Error); var (record, configuration) = inspected.Value;
            var instances = configuration.Roster.Instances.Select(instance =>
            {
                var state = states.GetValueOrDefault((fleet, instance.Key)) ?? new(instance, "stopped", null, null, null, false, false, null, null); var runtime = running.GetValueOrDefault((fleet, instance.Key)); var native = runtime is not null && !runtime.Lifetime.IsCancellationRequested ? runtime.NativeState() : null;
                return state with { Instance = instance, Phase = state.Phase == "running" && native is not null ? native.Phase : state.Phase, ListenerActive = runtime is not null && !runtime.Lifetime.IsCancellationRequested && runtime.ListenerActive, DesiredActive = wanted.Contains((fleet, instance.Key)), LastActivityAt = native?.LastActivityAt, HistoryAvailable = native?.HistoryAvailable };
            }).ToArray();
            var phase = new[] { "stopping", "awaiting-approval", "starting", "failed", "waking", "running", "sleeping" }.FirstOrDefault(phase => instances.Any(instance => instance.Phase == phase)) ?? "stopped";
            return Result<FleetState>.Success(new(record, controller, phase, selections.GetValueOrDefault(fleet), execution.Connection(configuration), instances, connectionErrors.GetValueOrDefault(record.Directory)));
        }
    }
    public Result<IReadOnlyList<FleetState>> List()
    {
        lock (gate) return Result<IReadOnlyList<FleetState>>.Success(records.OrderBy(record => record.FleetKey, StringComparer.Ordinal).Select(record => { var view = View(record.FleetId); return view.IsSuccess ? view.Value : new FleetState(record, controller, "failed", selections.GetValueOrDefault(record.FleetId), new(false, false, null, view.Error.Message), [], view.Error.Message); }).ToArray());
    }
    public Result<FleetState> Add(string directory)
    {
        lock (gate)
        {
            if (stopping) return Results.Fail<FleetState>("unavailable", "Controller is stopping"); var configuration = registry.Load(directory); if (!configuration.IsSuccess) return Result<FleetState>.Fail(configuration.Error); var valid = execution.Validate(configuration.Value); if (!valid.IsSuccess) return Result<FleetState>.Fail(valid.Error);
            if (records.Any(record => record.Directory == directory || record.FleetKey == configuration.Value.Roster.Fleet)) return Results.Fail<FleetState>("conflict", "Fleet directory or key is already registered"); if (records.Count >= 100) return Results.Fail<FleetState>("capacity", "Controller supports at most 100 registered fleets");
            var record = new FleetRegistration(Crossfire.Kernel.Identity.Identifier(), configuration.Value.Roster.Fleet, directory, configuration.Value.Roster.Fleet, 0, configuration.Value.Digest); var saved = Persist([..records, record]); if (!saved.IsSuccess) return Result<FleetState>.Fail(saved.Error); Connect(configuration.Value); return View(record.FleetId);
        }
    }
    private Result<(FleetRegistration Record, FleetConfiguration Configuration)> Mutable(string fleet, long revision)
    {
        if (stopping || mutations.Contains(fleet)) return Results.Fail<(FleetRegistration, FleetConfiguration)>("conflict", "Controller is stopping or a roster change is in progress"); var inspected = Inspect(fleet); if (!inspected.IsSuccess) return inspected;
        if (inspected.Value.Record.Revision != revision) return Results.Fail<(FleetRegistration, FleetConfiguration)>("stale_revision", "Refresh the fleet before changing it"); return Executing(fleet) ? Results.Fail<(FleetRegistration, FleetConfiguration)>("conflict", "Stop this fleet before changing its registry or roster") : inspected;
    }
    public Result<FleetState> Rename(string fleet, long revision, string label)
    { lock (gate) { var current = Mutable(fleet, revision); if (!current.IsSuccess) return Result<FleetState>.Fail(current.Error); if (label.Length is < 1 or > 100 || !TextRules.WellFormed(label) || label.Any(character => character is <= '\u001f' or '\u007f')) return Results.Fail<FleetState>("invalid", "Invalid fleet label"); var saved = Persist(records.Select(record => record.FleetId == fleet ? record with { Label = label, Revision = checked(revision + 1) } : record).ToArray()); return saved.IsSuccess ? View(fleet) : Result<FleetState>.Fail(saved.Error); } }
    public async ValueTask<Result<Unit>> Remove(string fleet, long revision, CancellationToken cancellation)
    {
        FleetConfiguration configuration; lock (gate) { var mutable = Mutable(fleet, revision); if (!mutable.IsSuccess) return Result<Unit>.Fail(mutable.Error); configuration = mutable.Value.Configuration; mutations.Add(fleet); }
        try { var archived = await execution.Archive(configuration, cancellation); if (!archived.IsSuccess) return archived; lock (gate) { var forgotten = ForgetSelection(fleet); if (!forgotten.IsSuccess) return forgotten; var removed = Persist(records.Where(record => record.FleetId != fleet).ToArray()); if (!removed.IsSuccess) return removed; deployed.Remove(fleet); foreach (var key in states.Keys.Where(key => key.Fleet == fleet).ToArray()) states.Remove(key); } await execution.Disconnect(configuration); return Results.Done(); }
        finally { EndMutation(fleet); }
    }
    public async ValueTask<Result<FleetState>> Edit(string fleet, long revision, string action, FleetInstance? addition, string? instanceKey, string? definition, CancellationToken cancellation)
    {
        FleetConfiguration configuration; lock (gate) { var mutable = Mutable(fleet, revision); if (!mutable.IsSuccess) return Result<FleetState>.Fail(mutable.Error); configuration = mutable.Value.Configuration; mutations.Add(fleet); }
        try
        {
            var key = addition?.Key ?? instanceKey; var existing = configuration.Roster.Instances.FirstOrDefault(instance => instance.Key == key); if (action == "add" && existing is not null) return Results.Fail<FleetState>("name_collision", "Instance key is already registered"); if (action != "add" && existing is null) return Results.Fail<FleetState>("missing", "Instance does not exist");
            if (action == "remove") { var removed = await execution.Remove(configuration, existing!, cancellation); if (!removed.IsSuccess) return Result<FleetState>.Fail(removed.Error); lock (gate) { var forgotten = ForgetSelection(fleet, key); if (!forgotten.IsSuccess) return Result<FleetState>.Fail(forgotten.Error); } }
            IReadOnlyList<FleetInstance> instances = action switch { "add" when addition is not null => [..configuration.Roster.Instances, addition], "remove" => configuration.Roster.Instances.Where(instance => instance.Key != key).ToArray(), "definition" when definition is not null => configuration.Roster.Instances.Select(instance => instance.Key == key ? instance with { Definition = definition } : instance).ToArray(), _ => throw new ArgumentException("Invalid roster edit") };
            var changed = registry.WriteRoster(configuration, configuration.Roster with { Instances = instances }); if (!changed.IsSuccess) return Result<FleetState>.Fail(changed.Error);
            lock (gate) { var stored = Persist(records.Select(record => record.FleetId == fleet ? record with { Digest = changed.Value.Digest, Revision = checked(revision + 1) } : record).ToArray()); if (!stored.IsSuccess) return Result<FleetState>.Fail(stored.Error); states.Remove((fleet, key!)); return View(fleet); }
        }
        finally { EndMutation(fleet); }
    }
    public async ValueTask<Result<RuntimeAttachment>> Attachment(string fleet, string key, string? context)
    { RunningAgent? runtime; lock (gate) { if (stopping || !running.TryGetValue((fleet, key), out runtime) || runtime.Lifetime.IsCancellationRequested) return Results.Fail<RuntimeAttachment>("conflict", "Resume this agent before attaching its terminal; reading a pointer never starts a session"); } return await runtime.Attachment(context); }
    public Result<IReadOnlyList<SavedRuntimeContext>> Contexts(string fleet, string key)
    { lock (gate) { var inspected = Inspect(fleet); if (!inspected.IsSuccess) return Result<IReadOnlyList<SavedRuntimeContext>>.Fail(inspected.Error); var instance = inspected.Value.Configuration.Roster.Instances.FirstOrDefault(instance => instance.Key == key); if (instance is null) return Results.Fail<IReadOnlyList<SavedRuntimeContext>>("missing", "Instance not found"); return running.TryGetValue((fleet, key), out var runtime) && !runtime.Lifetime.IsCancellationRequested ? runtime.Contexts() : execution.Contexts(inspected.Value.Configuration, instance); } }
    public async ValueTask<Result<Unit>> Test(string fleet, CancellationToken cancellation)
    {
        FleetState view; FleetConfiguration configuration; lock (gate) { var current = View(fleet); if (!current.IsSuccess) return Result<Unit>.Fail(current.Error); view = current.Value; var inspected = Inspect(fleet); if (!inspected.IsSuccess) return Result<Unit>.Fail(inspected.Error); configuration = inspected.Value.Configuration; }
        if (stopping || !view.Connection.Connected || !view.Connection.DeliveryEnabled || view.Error is not null) return Results.Fail<Unit>("conflict", "Controller delivery is not ready"); var selected = view.Instances.Where(instance => instance.DesiredActive).ToArray(); if (selected.Length == 0) return Results.Fail<Unit>("conflict", "This fleet is stopped; reading readiness never starts sessions");
        foreach (var instance in selected) { if (!instance.ListenerActive || instance.SessionId is null || instance.Phase is not ("running" or "sleeping") || instance.Error is not null) return Results.Fail<Unit>("conflict", "Instance " + instance.Instance.Key + " has no ready listener/native binding"); var tested = await execution.Test(configuration, instance.Instance, cancellation); if (!tested.IsSuccess) return Result<Unit>.Fail(tested.Error with { Message = instance.Instance.Key + ": " + tested.Error.Message }); } return Results.Done();
    }
    public ValueTask<Result<JsonElement>> Delivery(string fleet, long revision, bool enabled, CancellationToken cancellation)
    { lock (gate) { var current = Inspect(fleet); return !current.IsSuccess ? ValueTask.FromResult(Result<JsonElement>.Fail(current.Error)) : stopping ? ValueTask.FromResult(Results.Fail<JsonElement>("unavailable", "Controller is stopping")) : execution.Delivery(current.Value.Configuration, revision, enabled, cancellation); } }
    public ValueTask<Result<JsonElement>> Message(string fleet, string id, string body, CancellationToken cancellation)
    { lock (gate) { var current = Inspect(fleet); return !current.IsSuccess ? ValueTask.FromResult(Result<JsonElement>.Fail(current.Error)) : stopping ? ValueTask.FromResult(Results.Fail<JsonElement>("unavailable", "Controller is stopping")) : execution.Message(current.Value.Configuration, id, body, cancellation); } }
    public Result<FleetOperation> Operation(string id) { var value = registry.Operation(id); return !value.IsSuccess ? Result<FleetOperation>.Fail(value.Error) : value.Value is null ? Results.Fail<FleetOperation>("missing", "Operation not found") : Result<FleetOperation>.Success(value.Value); }
    public Result<Unit> AcknowledgeOperation(string id) { lock (gate) { var current = registry.Operation(id); if (!current.IsSuccess) return Result<Unit>.Fail(current.Error); return current.Value?.CompletedAt is null ? Results.Fail<Unit>("conflict", "Only completed native operations can release their receipt pin") : registry.SaveOperation(current.Value with { ReceiptPending = false }); } }
    public Result<bool> MaintainHistory(int days) => days < 1 ? Results.Fail<bool>("invalid", "Invalid logging retention") : registry.PruneOperations(checked(Now - days * 86400000L), 500);
    private void EndMutation(string fleet)
    { TaskCompletionSource? completion = null; lock (gate) { mutations.Remove(fleet); if (mutations.Count == 0) { completion = mutationCompletion; mutationCompletion = null; } } completion?.TrySetResult(); }
}
