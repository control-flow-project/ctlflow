using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record FleetRecord(string Id, string OwnerId, string FleetKey, string Label, string ControllerName,
    long Revision, long CreatedAt, long UpdatedAt, bool DeliveryEnabled, long? ArchivedAt);
public sealed record FleetCredential(string Id, string FleetId, string SecretHash, long CreatedAt, long? RevokedAt);
public sealed record FleetConnection(string FleetId, string ConnectionId, string CredentialId, long LastSeenAt, long ExpiresAt, long? ClosedAt);
public sealed record FleetConnectionView(string Status, long? LastSeenAt);
public sealed record FleetControlView(string FleetId, long Revision, bool DeliveryEnabled, FleetConnectionView Connection);
public abstract record FleetActor;
public sealed record FleetPrincipalActor(Actor Identity) : FleetActor;
public sealed record FleetControllerActor(string FleetId, string CredentialId) : FleetActor;
public sealed record FleetOperation(string OperationId, string FleetId, string? AgentId, string Action, long ExpectedRevision,
    string AuthorPrincipalId, string Status, long CreatedAt, long? CompletedAt, string? ErrorMessage, string? ConnectionId, string? CredentialId);
public sealed record FleetOperationView(string OperationId, string FleetId, string? AgentId, string Action, long ExpectedRevision,
    string Status, long CreatedAt, long? CompletedAt, string? ErrorMessage);
public sealed record FleetOperationRequest(string OperationId, string? AgentId, string Action, long ExpectedRevision, bool ConfirmFreshHistory);
public sealed record FleetOperationReceipt(string ConnectionId, string Status, string? ErrorMessage);
public sealed record FleetLiveConnection(FleetRecord Fleet, FleetConnection Connection);
public sealed record FleetPorts(AuthorizationPorts Authorization, UnitOfWork Transaction,
    Func<string, Result<FleetRecord?>> Find, Func<FleetRecord, Result<Unit>> Save,
    Func<string, Result<FleetCredential?>> Credential, Func<string, Result<FleetConnection?>> Connection,
    Func<FleetConnection, Result<Unit>> SaveConnection, Func<FleetRecord, Result<IReadOnlyList<FleetBinding>>> Bindings,
    Func<string, Result<FleetOperation?>> Operation, Func<string, Result<FleetOperation?>> PendingOperation,
    Func<string, int, int, Result<Page<FleetOperation>>> Operations,
    Func<FleetOperation, Result<Unit>> InsertOperation, Func<FleetOperation, Result<Unit>> SaveOperation,
    Func<AuditIntent, Result<Unit>> Audit);

public static class FleetValues
{
    public const long ControllerLeaseMs = 30000;
    public static FleetConnectionView Connection(FleetConnection? connection, long now)
        => new(connection is { ClosedAt: null } && connection.ExpiresAt > now ? "online" : "offline", connection?.LastSeenAt);
    public static FleetControlView Control(FleetRecord fleet, FleetConnection? connection, long now)
        => new(fleet.Id, fleet.Revision, fleet.DeliveryEnabled, Connection(connection, now));
    public static FleetOperationView View(FleetOperation operation)
        => new(operation.OperationId, operation.FleetId, operation.AgentId, operation.Action, operation.ExpectedRevision,
            operation.Status, operation.CreatedAt, operation.CompletedAt, operation.ErrorMessage);
    public static AuditIntent Audit(FleetActor actor, string requestId, FleetRecord fleet, string action, string message = "")
        => new(requestId, actor is FleetControllerActor ? "controller" : ((FleetPrincipalActor)actor).Identity.Kind,
            actor is FleetPrincipalActor principal ? principal.Identity.PrincipalId : null, fleet.OwnerId, "fleet", fleet.Id, action, Message: message,
            ActorCredentialId: actor is FleetControllerActor controller ? controller.CredentialId : null);
}
