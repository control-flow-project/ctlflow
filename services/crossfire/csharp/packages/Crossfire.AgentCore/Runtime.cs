using System.Text.Json;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public enum RuntimeApproval { None, Runtime, Listener }
public enum InputPriority { Steering }
public sealed record InputAdmission(InputPriority Priority, CancellationToken Cancellation);
public sealed record NativeSessionState(string Phase, long? LastActivityAt, bool HistoryAvailable);
public sealed record RuntimeDecisionChoice(string Label, JsonElement Value);
public sealed record RuntimeDecision(string Runtime, string Session, string Request, string Action, JsonElement Scope, IReadOnlyList<RuntimeDecisionChoice> Choices,
    string? Turn = null, string? Item = null, bool? Blocking = null, long? ExpiresMs = null, IReadOnlyList<DecisionQuestion>? Questions = null);
public abstract record RuntimeObservationEvent;
public sealed record NativeOutput(string SessionId, string Id, string? StreamId, string Text) : RuntimeObservationEvent;
public sealed record NativeState(string Runtime, string SessionId, string? RoomId, string State, long ObservedAt,
    IReadOnlyList<RuntimeSetting> Settings, string? ErrorMessage) : RuntimeObservationEvent;
public sealed record RuntimeHooks(Func<RuntimeDecision, CancellationToken, ValueTask<Result<JsonElement>>> RequestDecision,
    Action<UsageSample>? Usage = null, Action<RuntimeDecision>? DecisionResponded = null, Func<bool>? PendingDecisions = null,
    Func<bool>? PendingInput = null, Action<RuntimeObservationEvent>? Observe = null);
public interface TurnControl
{
    ValueTask<Result<string?>> ActiveTurn(string? room = null, InputAdmission? admission = null);
    ValueTask<Result<string>> Interrupt(string turnId, bool recovery = false, InputAdmission? admission = null);
}
public interface RuntimeLifecycle
{
    NativeSessionState Current();
    Result<Unit> ConfigureIdle(int seconds);
}
public interface RuntimeConnection : IAsyncDisposable
{
    string SessionId { get; }
    RuntimeApproval Approval { get; }
    CancellationToken Lifetime { get; }
    ValueTask<Result<bool>> Inspect();
    ValueTask<Result<Unit>> Deliver(string text, string messageId, CancellationToken cancellation = default, InputPriority? priority = null);
    ValueTask<Result<bool>> Settle(CancellationToken cancellation = default);
    ValueTask<Result<bool>> Recover(string text, string messageId, CancellationToken cancellation = default);
    Result<Unit> Acknowledge(IReadOnlyList<string> messageIds);
    TurnControl? TurnControl { get; }
    RuntimeLifecycle? Lifecycle { get; }
    ValueTask<Result<RuntimeConnection>> Conversation(string room, InputAdmission? admission = null);
}
