using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record FleetMessage(string Id, string FleetId, string? AuthorPrincipalId, string? AuthorCredentialId, string Body, long CreatedAt, long ExpiresAt);
public sealed record FleetMessageDelivery(string MessageId, string AgentId, string Status, long? CompletedAt, string? ErrorMessage);
public sealed record FleetMessageSummary(string MessageId, string Body, long CreatedAt, long ExpiresAt, int Total, int Delivered, int Failed, int Skipped, int Pending, int Expired);
public sealed record FleetMessageSender(string Kind, string? BackendUserId);
public sealed record FleetMessageCommand(string MessageId, string FleetId, string Body, long CreatedAt, long ExpiresAt, FleetMessageSender Sender, IReadOnlyList<string> AgentIds);
public sealed record FleetControlSnapshot(FleetControlView Control, IReadOnlyList<string> AgentIds, IReadOnlyList<FleetMessageCommand> Messages, IReadOnlyList<FleetOperationView> RuntimeOperations);
public sealed record FleetRecipient(string AgentId, string Status, string OwnerStatus);
public sealed record FleetMessagePorts(FleetPorts Fleet,
    Func<string, Result<FleetMessage?>> Find, Func<FleetMessage, Result<Unit>> Insert,
    Func<string, int, int, Result<Page<FleetMessage>>> Page,
    Func<IReadOnlyList<string>, Result<IReadOnlyList<FleetMessageDelivery>>> Deliveries,
    Func<string, string, Result<FleetMessageDelivery?>> Delivery,
    Func<FleetMessageDelivery, Result<Unit>> InsertDelivery, Func<FleetMessageDelivery, Result<Unit>> SaveDelivery,
    Func<string, long, Result<string?>> Pending, Func<string, long, Result<long>> PendingCount,
    Func<IReadOnlyList<string>, Result<IReadOnlyList<FleetRecipient>>> Recipients);

public static class FleetMessageValues
{
    public const long LifetimeMs = 600000;
    public const int MaxBytes = 16384;
    public static FleetMessageSummary Summary(FleetMessage message, IReadOnlyList<FleetMessageDelivery> deliveries, long now)
        => new(message.Id, message.Body, message.CreatedAt, message.ExpiresAt, deliveries.Count,
            deliveries.Count(value => value.Status == "delivered"), deliveries.Count(value => value.Status == "failed"),
            deliveries.Count(value => value.Status == "skipped"), deliveries.Count(value => value.Status == "pending" && message.ExpiresAt > now),
            deliveries.Count(value => value.Status == "pending" && message.ExpiresAt <= now));
}
