using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public static class ReceivePages
{
    public static int RoomQuota(int limit, int rooms, int position) => Math.Max(limit == 100 ? 10 : 1, limit / Math.Max(1, rooms) + (position < limit % Math.Max(1, rooms) ? 1 : 0));
    public static ValueTask<Result<IReadOnlySet<string>>> Joined(MessagingClient messaging, CancellationToken cancellation) => messaging.JoinedRooms(cancellation);
    public static ValueTask<Result<MessagePage>> History(MessagingClient messaging, string room, MessagePageRequest request, CancellationToken cancellation) => messaging.History(room, request, cancellation);
    public static ValueTask<Result<MessageFeed>> Sync(MessagingClient messaging, string? since, int timeout, CancellationToken cancellation) => messaging.Synchronize(since, timeout, cancellation);
    public static async ValueTask<Result<IReadOnlyList<ReceivedEvent>>> Origins(MessagingClient messaging, string self, IReadOnlyList<ReceivedEvent> events, CancellationToken cancellation)
    {
        var origins = await messaging.Origins(self, events.Select(value => value.RoomId).Distinct(StringComparer.Ordinal).ToArray(), cancellation);
        if (!origins.IsSuccess) return Result<IReadOnlyList<ReceivedEvent>>.Fail(origins.Error);
        var values = new List<ReceivedEvent>();
        foreach (var value in events)
        {
            if (!origins.Value.TryGetValue(value.RoomId, out var origin)) return Results.Fail<IReadOnlyList<ReceivedEvent>>("invalid", "Backend omitted message-origin evidence");
            values.Add(value with { Origin = new(origin.Kind, origin.Name, origin.Alias) });
        }
        return Result<IReadOnlyList<ReceivedEvent>>.Success(values);
    }
}
