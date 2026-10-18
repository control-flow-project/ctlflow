using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Fleetd.Domain;

public sealed record FleetInstance(string Key, string Name, string Definition, string Workarea, string? Workspace, JsonElement? RuntimeOptions, NativeHistoryMode HistoryMode = NativeHistoryMode.Shared);
public sealed record FleetCoordination(string Server, string Owner);
public sealed record FleetRoster(string Fleet, FleetCoordination Coordination, IReadOnlyList<FleetInstance> Instances);
public sealed record AgentDefinition(string Name, string Runtime, JsonElement Options, string Instructions, JsonElement CoordinationPolicy);
public sealed record FleetConfiguration(string Directory, FleetRoster Roster, IReadOnlyDictionary<string, AgentDefinition> Definitions, string Digest)
{
    public JsonElement NativeOptions(FleetInstance instance) => WireJson.Object(writer =>
    {
        foreach (var field in Definitions[instance.Definition].Options.EnumerateObject()) if (instance.RuntimeOptions is null || !instance.RuntimeOptions.Value.TryGetProperty(field.Name, out _)) field.WriteTo(writer);
        if (instance.RuntimeOptions is { } overrides) foreach (var field in overrides.EnumerateObject()) field.WriteTo(writer);
    });
}
public sealed record ControllerIdentity(string Name, IReadOnlyDictionary<string, string>? Metadata = null);
public sealed record FleetRegistration(string FleetId, string FleetKey, string Directory, string Label, long Revision, string Digest);
public sealed record DesiredIntent(string FleetId, string InstanceKey);
public sealed record ResumeSelection(string FleetId, IReadOnlyList<string> InstanceKeys);
public sealed record OperationTarget(string Kind, string? FleetId = null, string? InstanceKey = null);
public sealed record OperationRequest(string OperationId, OperationTarget Target, string Action, long ExpectedRevision, string? ReleaseDirectory = null);
public sealed record ApprovalLink(string Url, string Code);
public sealed record OperationError(string? InstanceKey, string Code, string Message);
public sealed record FleetOperation(OperationRequest Request, string Status, long CreatedAt, long? CompletedAt, ApprovalLink? Approval, IReadOnlyList<OperationError> Errors, bool ReceiptPending = false);
public sealed record FleetConnectionState(bool Connected, bool DeliveryEnabled, long? Revision, string? Error);
public sealed record InstanceState(FleetInstance Instance, string Phase, string? SessionId, string? Error, long? StartedAt, bool ListenerActive, bool DesiredActive, long? LastActivityAt, bool? HistoryAvailable);
public sealed record FleetState(FleetRegistration Registration, ControllerIdentity Controller, string Phase, IReadOnlyList<string>? ResumeInstanceKeys, FleetConnectionState Connection, IReadOnlyList<InstanceState> Instances, string? Error);
public sealed record SetupRequest(SetupDescriptor Descriptor, string Workspace, string? Configuration = null);
public sealed record SetupConfiguration(FleetConfiguration Configuration, string OperationId, bool Completed);
public sealed record SetupOutcome(FleetState Fleet, FleetOperation? Operation, string Status);
public sealed record FleetRegistry(Func<Result<IReadOnlyList<FleetRegistration>>> Registrations, Func<IReadOnlyList<FleetRegistration>, Result<Unit>> SaveRegistrations,
    Func<Result<IReadOnlyList<DesiredIntent>>> Desired, Func<IReadOnlyList<DesiredIntent>, Result<Unit>> SaveDesired,
    Func<Result<IReadOnlyList<ResumeSelection>>> Selections, Func<IReadOnlyList<ResumeSelection>, Result<Unit>> SaveSelections,
    Func<Result<IReadOnlyList<FleetOperation>>> PendingOperations, Func<string, Result<FleetOperation?>> Operation, Func<FleetOperation, Result<Unit>> SaveOperation,
    Func<long, int, Result<bool>> PruneOperations, Func<string, Result<FleetConfiguration>> Load, Func<FleetConfiguration, FleetRoster, Result<FleetConfiguration>> WriteRoster,
    Func<SetupRequest, Result<SetupConfiguration>> Setup, Func<string, Result<Unit>> CompleteSetup, Func<string, string, Result<Unit>> RetrySetup);
public sealed record ResumeWork(string Context, string SessionId, string MessageId, long CheckpointedAt);
public sealed record InterruptedContext(string Context, string SessionId);
public sealed record ResumeWorkStore(Func<Result<IReadOnlyList<ResumeWork>>> Read, Func<IReadOnlyList<InterruptedContext>, Result<Unit>> Capture, Func<string, Result<ResumeWork>> Renew, Func<IReadOnlyList<InterruptedContext>, Result<Unit>> Clear);
public sealed record NativeLifecycleServices(string Runtime, RuntimeApproval Approval, string Primary, string Initial, IReadOnlyList<RuntimeSetting> Settings, RuntimeHooks Hooks,
    ResumeWorkStore Work, Func<Result<IReadOnlyList<SavedRuntimeContext>>> Saved,
    Func<Action<RuntimeObservationEvent>, InputAdmission?, CancellationToken, ValueTask<Result<OwnedRuntimeConnection>>> Start,
    Action<string?, Failure> Failed, Action Recovered, TimeProvider Clock);
public interface RunningAgent : IAsyncDisposable
{
    string SessionId { get; }
    CancellationToken Lifetime { get; }
    bool DeliberatelyStopped { get; }
    bool ListenerActive { get; }
    NativeSessionState NativeState();
    ValueTask<Result<Unit>> Resume();
    ValueTask<Result<RuntimeAttachment>> Attachment(string? context = null);
    Result<IReadOnlyList<SavedRuntimeContext>> Contexts();
}
public sealed record FleetExecution(
    Func<FleetConfiguration, CancellationToken, Func<OperationRequest, ValueTask<Result<FleetOperation>>>, Func<string, Result<Unit>>, Result<Unit>> Connect,
    Func<FleetConfiguration, FleetConnectionState> Connection,
    Func<FleetConfiguration, long, bool, CancellationToken, ValueTask<Result<JsonElement>>> Delivery,
    Func<FleetConfiguration, string, string, CancellationToken, ValueTask<Result<JsonElement>>> Message,
    Func<FleetConfiguration, ValueTask> Disconnect,
    Func<FleetConfiguration, Result<Unit>> Validate,
    Func<FleetConfiguration, IReadOnlyList<FleetInstance>, CancellationToken, ValueTask<Result<Unit>>> Inspect,
    Func<FleetConfiguration, FleetInstance, CancellationToken, ValueTask<Result<Unit>>> Test,
    Func<FleetConfiguration, ControllerIdentity, string, CancellationToken, Action<ApprovalLink>, ValueTask<Result<Unit>>> Prepare,
    Func<FleetConfiguration, FleetInstance, CancellationToken, string, ValueTask<Result<RunningAgent>>> Start,
    Func<FleetConfiguration, FleetInstance, Result<IReadOnlyList<SavedRuntimeContext>>> Contexts,
    Func<FleetConfiguration, FleetInstance, CancellationToken, ValueTask<Result<Unit>>> ConfirmStopped,
    Func<FleetConfiguration, FleetInstance, string, CancellationToken, ValueTask<Result<Unit>>> Reset,
    Func<FleetConfiguration, FleetInstance, CancellationToken, ValueTask<Result<Unit>>> Remove,
    Func<FleetConfiguration, CancellationToken, ValueTask<Result<Unit>>> Archive,
    Func<FleetConfiguration, FleetInstance, string, CancellationToken, ValueTask<Result<Unit>>> Update);
