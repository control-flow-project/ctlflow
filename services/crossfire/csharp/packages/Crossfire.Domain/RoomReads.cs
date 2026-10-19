using System.Globalization;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record RoomDetails(string RoomId, string Name, string Topic, string? Alias, RoomFacts? Authority);

public static class RoomReads
{
    public static async ValueTask<Result<RoomDetails>> Read(RoomGrantPorts ports, MessagingPorts messaging, Actor actor, string roomId, string? agentId = null, CancellationToken cancellation = default)
    {
        var current = Authorization.ActiveActor(ports.Authorization, actor); if (!current.IsSuccess) return Result<RoomDetails>.Fail(current.Error);
        string? subject = null;
        if (agentId is not null)
        {
            var allowed = Authorization.Agent(ports.Authorization, actor, agentId, "read"); if (!allowed.IsSuccess) return Result<RoomDetails>.Fail(allowed.Error);
            subject = allowed.Value.Principal.BackendUserId;
            var conversation = ports.PrivateConversation(roomId); if (!conversation.IsSuccess) return Result<RoomDetails>.Fail(conversation.Error);
            if (conversation.Value is not null && (conversation.Value.Kind == "management" || conversation.Value.AgentId != agentId)) return Results.Fail<RoomDetails>("forbidden", "This private owner DM is not an agent assignment");
        }
        var native = await messaging.Room(current.Value.BackendUserId, roomId, subject, cancellation);
        if (native.IsSuccess) return Result<RoomDetails>.Success(new(roomId, native.Value.Name, native.Value.Topic, native.Value.Alias, native.Value));
        if (agentId is null) return Result<RoomDetails>.Fail(native.Error);
        var target = Authorization.Agent(ports.Authorization, actor, agentId, "read"); if (!target.IsSuccess) return Result<RoomDetails>.Fail(target.Error);
        var grant = ports.Find(agentId, roomId); if (!grant.IsSuccess) return Result<RoomDetails>.Fail(grant.Error);
        if (grant.Value is null) return Results.Fail<RoomDetails>("missing", "Assigned room not found");
        var observed = await messaging.Room(target.Value.Principal.BackendUserId, roomId, null, cancellation);
        return Result<RoomDetails>.Success(observed.IsSuccess ? new(roomId, observed.Value.Name, observed.Value.Topic, observed.Value.Alias, null) : new(roomId, roomId, "", null, null));
    }

    public static async ValueTask<Result<Page<RoomDetails>>> List(RoomGrantPorts ports, MessagingPorts messaging, Actor actor, int page, int size, string search, string? agentId = null, CancellationToken cancellation = default)
    {
        var current = Authorization.ActiveActor(ports.Authorization, actor); if (!current.IsSuccess) return Result<Page<RoomDetails>>.Fail(current.Error);
        var joined = await messaging.Joined(current.Value.BackendUserId, cancellation); if (!joined.IsSuccess) return Result<Page<RoomDetails>>.Fail(joined.Error);
        var ids = joined.Value.ToHashSet(StringComparer.Ordinal);
        if (agentId is not null)
        {
            var target = Authorization.Agent(ports.Authorization, actor, agentId, "read"); if (!target.IsSuccess) return Result<Page<RoomDetails>>.Fail(target.Error);
            var grants = ports.Grants(agentId); if (!grants.IsSuccess) return Result<Page<RoomDetails>>.Fail(grants.Error);
            foreach (var grant in grants.Value) ids.Add(grant.RoomId);
        }
        var rooms = new List<RoomDetails>(); var term = search.ToLowerInvariant();
        foreach (var id in ids.Order(StringComparer.Ordinal))
        {
            cancellation.ThrowIfCancellationRequested();
            if (agentId is not null)
            {
                var conversation = ports.PrivateConversation(id); if (!conversation.IsSuccess) return Result<Page<RoomDetails>>.Fail(conversation.Error);
                if (conversation.Value is not null && (conversation.Value.Kind == "management" || conversation.Value.AgentId != agentId)) continue;
            }
            var found = await Read(ports, messaging, actor, id, agentId, cancellation); if (!found.IsSuccess) return Result<Page<RoomDetails>>.Fail(found.Error);
            if (new[] { found.Value.Name, found.Value.Alias ?? "", id }.Any(value => value.ToLowerInvariant().Contains(term, StringComparison.Ordinal))) rooms.Add(found.Value);
        }
        var ordering = StringComparer.Create(CultureInfo.GetCultureInfo("en-US"), false);
        return Result<Page<RoomDetails>>.Success(new(rooms.OrderBy(value => value.Name, ordering).ThenBy(value => value.RoomId, ordering).Skip(checked((page - 1) * size)).Take(size).ToArray(), page, size, rooms.Count));
    }
}
