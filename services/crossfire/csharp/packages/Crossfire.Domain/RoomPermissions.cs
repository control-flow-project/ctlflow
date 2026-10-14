using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class RoomPermissions
{
    public static Result<Unit> Assign(RoomGrantPorts ports, RoomGrant grant, IReadOnlyList<string> permissions, string grantedByMemberId)
    {
        if (permissions.Count > 1 || permissions.Any(code => code != "room.agent.invite")) return Results.Fail<Unit>("invalid", "Unsupported room-scoped permission");
        return ports.ReplacePermissions(grant.AgentId, grant.RoomId, permissions.Select(code => new RoomPermission(grant.AgentId, grant.RoomId,
            grant.Generation, code, "agent_room", grantedByMemberId, ports.Authorization.Now())).ToArray());
    }

    public static Result<Unit> ApplyFleet(RoomGrantPorts ports, RoomGrant grant)
    {
        var policy = ports.FleetPolicy(grant.AgentId);
        if (!policy.IsSuccess) return Result<Unit>.Fail(policy.Error);
        if (policy.Value is null || grant.AccessMode == "none") return Results.Done();
        var conversation = ports.PrivateConversation(grant.RoomId);
        if (!conversation.IsSuccess) return Result<Unit>.Fail(conversation.Error);
        if (conversation.Value is not null) return Results.Done();
        var owner = ports.Authorization.Principal(policy.Value.ApprovedByMemberId);
        if (!owner.IsSuccess) return Result<Unit>.Fail(owner.Error);
        if (owner.Value?.Status != "active") return Results.Fail<Unit>("forbidden", "The fleet policy owner must be active");
        return Assign(ports, grant, policy.Value.Permissions, policy.Value.ApprovedByMemberId);
    }

    public static Result<long> Set(RoomGrantPorts ports, Actor actor, string agentId, string roomId, long expectedRevision,
        string expectedGeneration, IReadOnlyList<string> permissions, string requestId)
        => ports.Transaction.Run(() =>
        {
            if (actor.Kind != "human") return Results.Fail<long>("forbidden", "Agents cannot delegate invitation permission onward");
            var target = Authorization.Agent(ports.Authorization, actor, agentId, "room-grant.manage");
            if (!target.IsSuccess) return Result<long>.Fail(target.Error);
            var conversation = ports.PrivateConversation(roomId);
            if (!conversation.IsSuccess) return Result<long>.Fail(conversation.Error);
            if (conversation.Value is not null) return Results.Fail<long>("forbidden", "Owner DMs are private channels and cannot delegate invitations");
            if (target.Value.Principal.Revision != expectedRevision) return Results.Fail<long>("conflict", "Agent revision changed");
            if (target.Value.Principal.Status != "active" || target.Value.Owner.Status != "active") return Results.Fail<long>("forbidden", "Agent and owner must be active");
            var grant = ports.Find(agentId, roomId);
            if (!grant.IsSuccess) return Result<long>.Fail(grant.Error);
            if (grant.Value is null || grant.Value.AccessMode == "none" || grant.Value.Generation != expectedGeneration)
                return Results.Fail<long>("conflict", "An active matching room grant is required");
            var assigned = Assign(ports, grant.Value, permissions, actor.PrincipalId);
            if (!assigned.IsSuccess) return Result<long>.Fail(assigned.Error);
            var revised = ports.ReviseAgent(agentId, checked(expectedRevision + 1));
            if (!revised.IsSuccess) return Result<long>.Fail(revised.Error);
            var changed = ports.Save(grant.Value with { Revision = checked(grant.Value.Revision + 1), UpdatedAt = ports.Authorization.Now() }, false);
            if (!changed.IsSuccess) return Result<long>.Fail(changed.Error);
            return ports.Audit(new(requestId, actor.Kind, actor.PrincipalId, target.Value.Owner.Id, "agent", agentId, "room-permission.set",
                RoomId: roomId, MembershipGeneration: grant.Value.Generation, PermissionCode: "room.agent.invite")).Map(_ => checked(expectedRevision + 1));
        });
}
