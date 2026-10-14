using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record DecisionOption(string Id, string Label, string Description);
public sealed record DecisionQuestion(string Id, string Title, string Prompt, bool Secret, bool AllowText, IReadOnlyList<DecisionOption> Options);
public sealed record DecisionCreation(string Id, string RunId, string Runtime, string SessionId, string RequestId, string TurnId, string ItemId,
    string Kind, string Action, string Review, bool Blocking, long? ExpiresAt, IReadOnlyList<DecisionQuestion> Questions);
public sealed record DecisionView(DecisionCreation Native, string AgentId, long CreatedAt, string Status);
public sealed record DecisionAnswer(string QuestionId, string? OptionId, string? Text);
public sealed record DecisionPoll(string Status, IReadOnlyList<DecisionAnswer> Answers);
public sealed record DecisionSummary(string Id, string AgentId, string RunId, string Runtime, string SessionId, string RequestId,
    string TurnId, string ItemId, string Kind, string Action, bool Blocking, long? ExpiresAt, long CreatedAt, string Status);
public sealed record DecisionPorts(AuthorizationPorts Authorization, UnitOfWork Transaction,
    Func<string, string, Result<Unit>> LiveRun, Func<string, Result<DecisionView?>> Find,
    Func<DecisionView, Result<Unit>> Insert, Func<string, IReadOnlyList<DecisionAnswer>, Result<Unit>> Answer,
    Func<string, Result<IReadOnlyList<DecisionAnswer>>> Answers, Func<string, string, Result<Unit>> Status,
    Func<Result<IReadOnlyList<DecisionSummary>>> Pending, Func<AuditIntent, Result<Unit>> Audit);

public sealed record ListenerController(string FleetId, string ConnectionId, string CredentialId);
public sealed record ListenerRun(string Id, string AgentId, string? Release, ListenerController? Controller,
    long StartedAt, long LastSeenAt, long ActiveMs, long MessagesDelivered, long? StoppedAt, long? DisconnectRequestedAt);
public sealed record ControllerAdmissionFacts(string OwnerStatus, string BindingOwnerId, string BindingFleetKey, long? RetiredAt,
    string FleetId, string FleetOwnerId, string FleetKey, long? ArchivedAt, bool DeliveryEnabled,
    string ConnectionId, string CredentialId, long? ClosedAt, long ExpiresAt, string CredentialFleetId, long? CredentialRevokedAt);

public static class ControllerAdmission
{
    public const long HeartbeatExpiryMs = 90000;

    public static bool Admits(ListenerRun run, ControllerAdmissionFacts? facts, long now)
        => run.Controller is not null && facts is not null && facts.OwnerStatus == "active" && facts.RetiredAt is null && facts.ArchivedAt is null
            && facts.BindingOwnerId == facts.FleetOwnerId && facts.BindingFleetKey == facts.FleetKey
            && facts.FleetId == run.Controller.FleetId && facts.DeliveryEnabled
            && facts.ConnectionId == run.Controller.ConnectionId && facts.CredentialId == run.Controller.CredentialId
            && facts.ClosedAt is null && facts.ExpiresAt > now && facts.CredentialFleetId == facts.FleetId && facts.CredentialRevokedAt is null;
}
