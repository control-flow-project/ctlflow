using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class RoomGrantAuthorization
{
    public static async ValueTask<Result<GrantProof>> Authorize(RoomGrantPorts ports, Actor actor, GrantChange input,
        RoomInvitation? invitation = null, CancellationToken cancellation = default)
    {
        var acting = Authorization.ActiveActor(ports.Authorization, actor);
        if (!acting.IsSuccess) return Result<GrantProof>.Fail(acting.Error);
        var protectedAccess = RoomGrantValues.Protect(ports, input);
        if (!protectedAccess.IsSuccess) return Result<GrantProof>.Fail(protectedAccess.Error);
        var target = ports.Authorization.AgentView(input.AgentId);
        if (!target.IsSuccess) return Result<GrantProof>.Fail(target.Error);
        if (target.Value is null) return Results.Fail<GrantProof>("missing", "Target agent not found");
        if (input.AccessMode != "none" && (target.Value.Principal.Status != "active" || target.Value.Owner.Status != "active"))
            return Results.Fail<GrantProof>("forbidden", "Target and its owner must be active");
        if (target.Value.Principal.Revision != input.ExpectedRevision) return Results.Fail<GrantProof>("conflict", "Agent revision changed");
        if (input.AccessMode is not ("none" or "read" or "reply" or "custom") || (input.AccessMode == "custom") != (input.NativeAccess is not null)
            || input.NativeAccess is { } nativeAccess && !BackendData.Valid(nativeAccess) || input.AccessMode == "none" && input.Muted)
            return Results.Fail<GrantProof>("invalid", "Invalid room access settings");
        var stored = ports.Find(input.AgentId, input.RoomId);
        if (!stored.IsSuccess) return Result<GrantProof>.Fail(stored.Error);
        var previous = stored.Value;
        var freshInvitation = invitation is not null && invitation.EventId != previous?.InvitationEventId;
        if (invitation is not null && (invitation.RoomId != input.RoomId || invitation.SenderBackendUserId != acting.Value.BackendUserId
            || input.AccessMode != "reply" || input.NativeAccess is not null || input.Muted))
            return Results.Fail<GrantProof>("invalid", "Native invitation does not match the grant intent");
        if (invitation is not null && previous?.InvitationEventId == invitation.EventId && previous.AccessMode == "none")
            return Results.Fail<GrantProof>("forbidden", "This invitation was already withdrawn");
        if (previous?.Generation != input.ExpectedGeneration) return Results.Fail<GrantProof>("conflict", "Room membership generation changed");
        string? inviterGeneration = null; long? inviterRevision = null;
        if (actor.Kind == "human")
        {
            var permitted = Authorization.Agent(ports.Authorization, actor, input.AgentId, "room-grant.manage");
            if (!permitted.IsSuccess) return Result<GrantProof>.Fail(permitted.Error);
        }
        else
        {
            if (input.AgentId == actor.PrincipalId) return Results.Fail<GrantProof>("forbidden", "An agent cannot grant itself room access");
            var inviter = ports.Find(actor.PrincipalId, input.RoomId);
            if (!inviter.IsSuccess) return Result<GrantProof>.Fail(inviter.Error);
            var permissions = ports.Permissions(actor.PrincipalId, input.RoomId);
            if (!permissions.IsSuccess) return Result<GrantProof>.Fail(permissions.Error);
            if (inviter.Value is null || inviter.Value.AccessMode == "none"
                || !permissions.Value.Any(value => value.PermissionCode == "room.agent.invite" && value.Generation == inviter.Value.Generation))
                return Results.Fail<GrantProof>("forbidden", "This room requires explicit agent invitation permission");
            inviterGeneration = inviter.Value.Generation; inviterRevision = inviter.Value.Revision;
            if (previous is not null && previous.AccessMode != "none" && previous.AddedById != actor.PrincipalId
                && (freshInvitation || input.AccessMode == "none" || !RoomGrantValues.Same(previous, input)))
                return Results.Fail<GrantProof>("forbidden", "An agent can change or remove only its own room additions");
        }
        var changed = freshInvitation || (previous is null ? input.AccessMode != "none" : !RoomGrantValues.Same(previous, input));
        var needsNative = input.AccessMode != "none" && changed && (freshInvitation || previous is null || previous.AccessMode == "none"
            || previous.AccessMode != input.AccessMode || !BackendData.Equal(previous.NativeAccess, input.NativeAccess));
        RoomFacts? native = null;
        if (needsNative || actor.Kind == "agent" && input.AccessMode != "none")
        {
            var facts = await ports.AuthorizeRoomAccess(acting.Value.BackendUserId, target.Value.Principal.BackendUserId, input.RoomId,
                new(input.AccessMode, input.NativeAccess, input.Muted), cancellation);
            if (!facts.IsSuccess) return Result<GrantProof>.Fail(facts.Error);
            if (actor.Kind == "agent" && !facts.Value.CanInvite)
                return Results.Fail<GrantProof>("forbidden", "The inviter lacks backend invitation authority");
            native = facts.Value;
        }
        return Result<GrantProof>.Success(new(input, previous, acting.Value.Revision, target.Value.Principal.Revision, target.Value.Owner.Revision,
            inviterGeneration, inviterRevision, needsNative ? actor.PrincipalId : previous?.AuthorizerId ?? actor.PrincipalId, native, changed,
            invitation?.EventId ?? previous?.InvitationEventId, invitation is not null ? "invitation" : needsNative ? "managed" : previous?.AdmissionKind ?? "managed"));
    }

    public static Result<Unit> Recheck(RoomGrantPorts ports, Actor actor, GrantProof proof)
    {
        var protect = RoomGrantValues.Protect(ports, proof.Input);
        if (!protect.IsSuccess) return protect;
        var acting = Authorization.ActiveActor(ports.Authorization, actor);
        if (!acting.IsSuccess) return Result<Unit>.Fail(acting.Error);
        if (acting.Value.Revision != proof.ActorRevision) return Results.Fail<Unit>("conflict", "Acting authority changed");
        var target = ports.Authorization.AgentView(proof.Input.AgentId);
        if (!target.IsSuccess) return Result<Unit>.Fail(target.Error);
        if (target.Value is null || target.Value.Principal.Revision != proof.TargetRevision || target.Value.Owner.Revision != proof.OwnerRevision)
            return Results.Fail<Unit>("conflict", "Target authority changed");
        var current = ports.Find(proof.Input.AgentId, proof.Input.RoomId);
        if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
        if (current.Value?.Generation != proof.Previous?.Generation || current.Value?.Revision != proof.Previous?.Revision)
            return Results.Fail<Unit>("conflict", "Room grant changed");
        if (actor.Kind == "human") return Authorization.Agent(ports.Authorization, actor, proof.Input.AgentId, "room-grant.manage").Map(_ => default(Unit));
        var inviter = ports.Find(actor.PrincipalId, proof.Input.RoomId);
        if (!inviter.IsSuccess) return Result<Unit>.Fail(inviter.Error);
        var permissions = ports.Permissions(actor.PrincipalId, proof.Input.RoomId);
        if (!permissions.IsSuccess) return Result<Unit>.Fail(permissions.Error);
        return inviter.Value is null || inviter.Value.Generation != proof.InviterGeneration || inviter.Value.Revision != proof.InviterRevision
            || inviter.Value.AccessMode == "none" || !permissions.Value.Any(value => value.PermissionCode == "room.agent.invite" && value.Generation == proof.InviterGeneration)
            ? Results.Fail<Unit>("conflict", "Room invitation authority changed") : Results.Done();
    }
}
