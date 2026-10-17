using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Domain;
using Crossfire.Kernel;
using Fleetd.Domain;

namespace Fleetd.Domain.Tests;

public sealed class ControllerFixture : IAsyncDisposable
{
    public const string FleetId = "00000000-0000-4000-8000-000000000001";
    public const string SessionId = "00000000-0000-4000-8000-000000000002";
    private readonly object gate = new();
    private readonly TaskCompletionSource<RunningAgent> release = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly Dictionary<string, FleetOperation> operations = new(StringComparer.Ordinal);
    private readonly Dictionary<string, TaskCompletionSource<FleetOperation>> completions = new(StringComparer.Ordinal);
    private IReadOnlyList<FleetRegistration> registrations;
    private IReadOnlyList<DesiredIntent> desired = [new(FleetId, "analyst")];
    private IReadOnlyList<ResumeSelection> selections = [];
    private readonly List<ProbeAgent> agents = [];
    private int starts;
    public int Starts => Volatile.Read(ref starts);
    public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public CancellationToken Starting { get; private set; }
    public FleetController Controller { get; }
    public ProbeAgent First { get; } = new();
    public ControllerFixture()
    {
        var instance = new FleetInstance("analyst", "Analyst", "analyst", "workarea", null, null);
        var configuration = new FleetConfiguration("/isolated/controller-fixture", new("research", new("https://contract.invalid", "@owner:contract.invalid"), [instance]),
            new Dictionary<string, AgentDefinition>(StringComparer.Ordinal), new string('a', 64));
        registrations = [new(FleetId, "research", configuration.Directory, "Research", 0, configuration.Digest)];
        var registry = new FleetRegistry(
            () => { lock (gate) return Result<IReadOnlyList<FleetRegistration>>.Success(registrations); },
            values => { lock (gate) registrations = values; return Results.Done(); },
            () => { lock (gate) return Result<IReadOnlyList<DesiredIntent>>.Success(desired); },
            values => { lock (gate) desired = values; return Results.Done(); },
            () => { lock (gate) return Result<IReadOnlyList<ResumeSelection>>.Success(selections); },
            values => { lock (gate) selections = values; return Results.Done(); },
            () => Result<IReadOnlyList<FleetOperation>>.Success([]),
            id => { lock (gate) return Result<FleetOperation?>.Success(operations.GetValueOrDefault(id)); }, Save,
            (_, _) => Result<bool>.Success(false), _ => Result<FleetConfiguration>.Success(configuration),
            (_, _) => Results.Fail<FleetConfiguration>("invalid", "No roster mutation in this fixture"),
            _ => Results.Fail<SetupConfiguration>("invalid", "No setup in this fixture"), _ => Results.Done(), (_, _) => Results.Done());
        var execution = new FleetExecution((_, _, _, _) => Results.Done(), _ => new(true, true, 0, null),
            (_, _, _, _) => ValueTask.FromResult(Results.Fail<JsonElement>("invalid", "No delivery change in this fixture")),
            (_, _, _, _) => ValueTask.FromResult(Results.Fail<JsonElement>("invalid", "No message in this fixture")),
            _ => ValueTask.CompletedTask, _ => Results.Done(), (_, _, _) => ValueTask.FromResult(Results.Done()),
            (_, _, _) => ValueTask.FromResult(Results.Done()), (_, _, _, _, _) => ValueTask.FromResult(Results.Done()),
            Start, (_, _) => First.Contexts(), (_, _, _) => ValueTask.FromResult(Results.Done()),
            (_, _, _, _) => ValueTask.FromResult(Results.Done()), (_, _, _) => ValueTask.FromResult(Results.Done()),
            (_, _) => ValueTask.FromResult(Results.Done()), (_, _, _, _) => ValueTask.FromResult(Results.Done()));
        Controller = FleetController.Create(registry, execution, new("isolated"), TimeProvider.System).Value;
    }
    private async ValueTask<Result<RunningAgent>> Start(FleetConfiguration configuration, FleetInstance instance, CancellationToken cancellation, string reason)
    {
        var count = Interlocked.Increment(ref starts);
        if (count == 1) { Starting = cancellation; Entered.TrySetResult(); return Result<RunningAgent>.Success(await release.Task); }
        var agent = new ProbeAgent(); lock (gate) agents.Add(agent); return Result<RunningAgent>.Success(agent);
    }
    private Result<Unit> Save(FleetOperation operation)
    {
        TaskCompletionSource<FleetOperation>? completion;
        lock (gate) { operations[operation.Request.OperationId] = operation; completion = completions.GetValueOrDefault(operation.Request.OperationId); }
        if (operation.CompletedAt is not null) completion?.TrySetResult(operation); return Results.Done();
    }
    public void Release() => release.TrySetResult(First);
    public Task<FleetOperation> Completion(string id)
    {
        lock (gate)
        {
            if (operations.GetValueOrDefault(id) is { CompletedAt: not null } existing) return Task.FromResult(existing);
            if (!completions.TryGetValue(id, out var completion)) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); completions.Add(id, completion); } return completion.Task;
        }
    }
    public ValueTask<Result<FleetOperation>> Operate(string action, bool individual = false)
        => Controller.Operate(new(Identity.Identifier(), new(individual ? "agent" : "fleet", FleetId, individual ? "analyst" : null), action, 0));
    public async ValueTask DisposeAsync()
    {
        Release(); try { await Controller.DisposeAsync(); } finally { await First.DisposeAsync(); ProbeAgent[] owned; lock (gate) owned = agents.ToArray(); foreach (var agent in owned) await agent.DisposeAsync(); }
    }
}

public sealed class ProbeAgent : RunningAgent
{
    private readonly CancellationTokenSource lifetime = new();
    private readonly CancellationToken lifetimeToken;
    private int disposals;
    public bool Disposed => Volatile.Read(ref disposals) != 0;
    public string SessionId => ControllerFixture.SessionId;
    public CancellationToken Lifetime => lifetimeToken;
    public bool DeliberatelyStopped => false;
    private ListenerControl Control { get; }
    public bool ListenerActive => Control.Current().Active;
    public ProbeAgent()
    {
        lifetimeToken = lifetime.Token; Control = new(() => new(ControllerFixture.FleetId, "connection", "credential"), (_, _, _, _) => ValueTask.FromResult(Results.Done())); Control.Update(true, true, null);
    }
    public NativeSessionState NativeState() => new("sleeping", 0, true);
    public ValueTask<Result<Unit>> Resume() => ValueTask.FromResult(Results.Done());
    public ValueTask<Result<RuntimeAttachment>> Attachment(string? context = null)
        => ValueTask.FromResult(Result<RuntimeAttachment>.Success(new("codex", SessionId, "/isolated/controller-fixture", new Dictionary<string, string>())));
    public Result<IReadOnlyList<SavedRuntimeContext>> Contexts()
        => Result<IReadOnlyList<SavedRuntimeContext>>.Success([new("shared", "codex", SessionId, "/isolated/controller-fixture")]);
    public async ValueTask DisposeAsync()
    { if (Interlocked.Exchange(ref disposals, 1) != 0) return; try { await lifetime.CancelAsync(); } finally { Control.Dispose(); lifetime.Dispose(); } }
}
