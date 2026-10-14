using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record WakeNotice(string ReceiverAgentId, string EventId, string SenderMatrixId, string RoomId, long ReservedAt, string MessageBody, string Status, long? SentAt, string? NativeEventId, long? NextAttemptAt, string? LastError);
public sealed record WakeNoticePorts(AgentRoutingPorts Routing, MatrixPorts Matrix,
    Func<string, string, Result<WakeNotice?>> Find, Func<WakeNotice, bool, Result<Unit>> Save,
    Func<string, string, long, Result<bool>> Recent, Func<long, Result<IReadOnlyList<WakeNotice>>> Due);

public static class WakeNotices
{
    public static async ValueTask<Result<string>> Request(WakeNoticePorts ports, Actor actor, string agentId, string roomId, string eventId, CancellationToken cancellation = default)
    {
        var grants = ports.Routing.Grants; var authority = Authorization.Require(grants.Authorization, actor, "wake-notice.publish.self"); if (!authority.IsSuccess) return Result<string>.Fail(authority.Error);
        if (actor.PrincipalId != agentId) return Results.Fail<string>("missing", "Receiving agent not found");
        var agent = grants.Authorization.AgentView(agentId); if (!agent.IsSuccess) return Result<string>.Fail(agent.Error);
        if (agent.Value is null) return Results.Fail<string>("missing", "Receiving agent not found");
        var native = await ports.Matrix.Event(agent.Value.Principal.MatrixUserId, roomId, eventId, cancellation); if (!native.IsSuccess) return Result<string>.Fail(native.Error);
        return grants.Transaction.Run(() =>
        {
            var allowed = Authorization.Require(grants.Authorization, actor, "wake-notice.publish.self"); if (!allowed.IsSuccess) return Result<string>.Fail(allowed.Error);
            var target = grants.Authorization.AgentView(agentId); if (!target.IsSuccess) return Result<string>.Fail(target.Error);
            if (target.Value is null) return Results.Fail<string>("missing", "Receiving agent not found");
            var previous = ports.Find(agentId, eventId); if (!previous.IsSuccess) return Result<string>.Fail(previous.Error);
            if (previous.Value is not null) return Result<string>.Success(previous.Value.Status);
            var message = native.Value;
            if (message.EventId != eventId || message.RoomId != roomId || message.Type != "m.room.message" || message.MessageType != "m.text" || message.Edited || message.Control
                || message.SenderMatrixId == target.Value.Principal.MatrixUserId || !message.Mentions.Contains(target.Value.Principal.MatrixUserId, StringComparer.Ordinal)) return Result<string>.Success("not-applicable");
            var grant = grants.Find(agentId, roomId); if (!grant.IsSuccess) return Result<string>.Fail(grant.Error);
            if (grant.Value is null || grant.Value.AccessMode is "none" or "read" || grant.Value.Muted) return Result<string>.Success("not-permitted");
            var senders = AgentRouting.Senders(ports.Routing, target.Value); if (!senders.IsSuccess) return Result<string>.Fail(senders.Error);
            if (senders.Value.Contains(message.SenderMatrixId, StringComparer.Ordinal)) return Result<string>.Success("not-applicable");
            var now = grants.Authorization.Now(); var recent = ports.Recent(agentId, message.SenderMatrixId, now - 600000); if (!recent.IsSuccess) return Result<string>.Fail(recent.Error);
            if (recent.Value) return Result<string>.Success("rate-limited");
            var body = message.SenderMatrixId + ", " + target.Value.Name + " won’t wake under its current rules. " + target.Value.OwnerMember.DisplayName + " (" + target.Value.Owner.MatrixUserId + ") can change them.";
            return ports.Save(new(agentId, eventId, message.SenderMatrixId, roomId, now, body, "pending", null, null, now, null), true).Map(_ => "pending");
        });
    }

    public static async ValueTask<Result<Unit>> Publish(WakeNoticePorts ports, string agentId, string eventId, CancellationToken cancellation = default)
    {
        var found = ports.Find(agentId, eventId); if (!found.IsSuccess) return Result<Unit>.Fail(found.Error);
        if (found.Value is not { Status: "pending" } notice) return Results.Done();
        var grants = ports.Routing.Grants; var agent = grants.Authorization.AgentView(agentId); if (!agent.IsSuccess) return Result<Unit>.Fail(agent.Error);
        var grant = grants.Find(agentId, notice.RoomId); if (!grant.IsSuccess) return Result<Unit>.Fail(grant.Error);
        Result<string> sent;
        if (agent.Value is null || agent.Value.Principal.Status != "active" || agent.Value.Owner.Status != "active" || grant.Value is null || grant.Value.AccessMode is "none" or "read" || grant.Value.Muted)
            sent = Results.Fail<string>("forbidden", "The receiver no longer permits a room notice");
        else
        {
            var senders = AgentRouting.Senders(ports.Routing, agent.Value); if (!senders.IsSuccess) return Result<Unit>.Fail(senders.Error);
            sent = senders.Value.Contains(notice.SenderMatrixId, StringComparer.Ordinal) && notice.LastError is null ? Results.Fail<string>("forbidden", "The sender now has wake authority")
                : await ports.Matrix.SendNotice(agent.Value.Principal.MatrixUserId, notice.RoomId, Identity.Hash("wake-notice:" + agentId + ":" + eventId), notice.MessageBody, notice.SenderMatrixId, cancellation);
        }
        return grants.Transaction.Run(() =>
        {
            var current = ports.Find(agentId, eventId); if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
            if (current.Value is not { Status: "pending" }) return Results.Done();
            var denied = !sent.IsSuccess && sent.Error.Code == "forbidden" && notice.LastError is null;
            return ports.Save(current.Value with { Status = sent.IsSuccess ? "sent" : denied ? "denied" : "pending", SentAt = sent.IsSuccess ? grants.Authorization.Now() : null,
                NativeEventId = sent.IsSuccess ? sent.Value : null, NextAttemptAt = sent.IsSuccess || denied ? null : grants.Authorization.Now() + 30000, LastError = sent.IsSuccess ? null : sent.Error.Message }, false);
        });
    }
}
