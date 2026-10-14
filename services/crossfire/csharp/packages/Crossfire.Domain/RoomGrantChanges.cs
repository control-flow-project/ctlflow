using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class RoomGrantChanges
{
    public static async ValueTask<Result<GrantResult>> Change(RoomGrantPorts ports, Actor actor, GrantChange input, string requestId,
        RoomInvitation? invitation = null, CancellationToken cancellation = default)
    {
        var authorized = await RoomGrantAuthorization.Authorize(ports, actor, input, invitation, cancellation);
        if (!authorized.IsSuccess) return Result<GrantResult>.Fail(authorized.Error);
        return ports.Transaction.Run(() =>
        {
            var rechecked = RoomGrantAuthorization.Recheck(ports, actor, authorized.Value);
            if (!rechecked.IsSuccess) return Result<GrantResult>.Fail(rechecked.Error);
            var grants = ports.Grants(input.AgentId);
            if (!grants.IsSuccess) return Result<GrantResult>.Fail(grants.Error);
            var conversation = ports.OwnerConversationRoom(input.AgentId);
            if (!conversation.IsSuccess) return Result<GrantResult>.Fail(conversation.Error);
            var activeCount = grants.Value.Count(value => value.AccessMode != "none" && value.RoomId != conversation.Value);
            if (input.AccessMode != "none" && (authorized.Value.Previous is null || authorized.Value.Previous.AccessMode == "none") && activeCount >= 100)
                return Results.Fail<GrantResult>("limit", "An agent can have at most 100 room grants in addition to its owner DM");
            var saved = Commit(ports, actor, authorized.Value, requestId, "room");
            if (!saved.IsSuccess) return Result<GrantResult>.Fail(saved.Error);
            if (!authorized.Value.Changed) return Result<GrantResult>.Success(new(saved.Value, input.ExpectedRevision));
            return ports.ReviseAgent(input.AgentId, checked(input.ExpectedRevision + 1)).Map(_ => new GrantResult(saved.Value, checked(input.ExpectedRevision + 1)));
        });
    }

    public static Result<RoomGrant?> Commit(RoomGrantPorts ports, Actor actor, GrantProof proof, string requestId, string purpose)
    {
        if (!proof.Changed) return Result<RoomGrant?>.Success(proof.Previous);
        var input = proof.Input; var previous = proof.Previous;
        var newGeneration = previous is null || previous.AccessMode == "none" && input.AccessMode != "none"
            || proof.InvitationEventId is not null && proof.InvitationEventId != previous.InvitationEventId;
        var generation = newGeneration ? ports.Identifier() : previous!.Generation;
        var accessChanged = previous is null || previous.AccessMode != input.AccessMode || previous.PowerLevel != input.PowerLevel;
        if (newGeneration || input.AccessMode == "none")
        {
            var removed = ports.ReplacePermissions(input.AgentId, input.RoomId, []);
            if (!removed.IsSuccess) return Result<RoomGrant?>.Fail(removed.Error);
        }
        var grant = new RoomGrant(input.AgentId, input.RoomId, generation, proof.AuthorizerId, newGeneration ? actor.PrincipalId : previous!.AddedById,
            proof.InvitationEventId, proof.AdmissionKind, input.AccessMode, input.PowerLevel, input.Muted,
            checked((previous?.Revision ?? -1) + 1), checked((previous?.AccessRevision ?? -1) + (accessChanged ? 1 : 0)), ports.Authorization.Now());
        var saved = ports.Save(grant, previous is null);
        if (!saved.IsSuccess) return Result<RoomGrant?>.Fail(saved.Error);
        if (purpose == "room" && newGeneration && input.AccessMode != "none")
        {
            var assigned = RoomPermissions.ApplyFleet(ports, grant);
            if (!assigned.IsSuccess) return Result<RoomGrant?>.Fail(assigned.Error);
        }
        var application = ports.Application(input.AgentId, input.RoomId);
        if (!application.IsSuccess) return Result<RoomGrant?>.Fail(application.Error);
        var scheduled = ports.SaveApplication(application.Value is null
            ? new(input.AgentId, input.RoomId, null, null, null, null, false, null, null, null, ports.Authorization.Now(), null, null)
            : application.Value with { NextCheckAt = ports.Authorization.Now() });
        if (!scheduled.IsSuccess) return Result<RoomGrant?>.Fail(scheduled.Error);
        var target = ports.Authorization.Agent(input.AgentId);
        if (!target.IsSuccess) return Result<RoomGrant?>.Fail(target.Error);
        return ports.Audit(new(requestId, actor.Kind, actor.PrincipalId, target.Value?.OwnerId, "agent", input.AgentId,
            input.AccessMode == "none" ? "room-grant.remove" : "room-grant.set", RoomId: input.RoomId, MembershipGeneration: generation,
            AuthorizerId: grant.AuthorizerId, AddedById: grant.AddedById, PermissionCode: actor.Kind == "agent" ? "room.agent.invite" : null)).Map(_ => (RoomGrant?)grant);
    }
}
