using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class RoomReconciliation
{
    public static ValueTask<Result<Unit>> Reconcile(RoomReconcilePorts ports, string agentId, string roomId, CancellationToken cancellation = default)
        => ports.Operation(roomId, token => Apply(ports, agentId, roomId, token), cancellation);

    private static async ValueTask<Result<Unit>> Apply(RoomReconcilePorts ports, string agentId, string roomId, CancellationToken cancellation)
    {
        var target = ports.Grants.Authorization.AgentView(agentId);
        if (!target.IsSuccess) return Result<Unit>.Fail(target.Error);
        var stored = ports.Grants.Find(agentId, roomId);
        if (!stored.IsSuccess) return Result<Unit>.Fail(stored.Error);
        var application = ports.Grants.Application(agentId, roomId);
        if (!application.IsSuccess) return Result<Unit>.Fail(application.Error);
        var policy = ports.Policy();
        if (!policy.IsSuccess) return Result<Unit>.Fail(policy.Error);
        if (target.Value is null || stored.Value is null || application.Value is null || policy.Value is null)
            return Results.Fail<Unit>("missing", "Room grant reconciliation state is missing");
        var agent = target.Value; var grant = stored.Value; var previous = application.Value;
        var conversation = ports.Grants.OwnerConversationRoom(agentId);
        if (!conversation.IsSuccess) return Result<Unit>.Fail(conversation.Error);
        var repairDirect = conversation.Value == roomId && previous.ObservedGeneration == grant.Generation
            && previous.AppliedAccessRevision == grant.AccessRevision && previous.LastSuccessAt is not null;
        var authorizer = ports.Grants.Authorization.Principal(grant.AuthorizerId);
        if (!authorizer.IsSuccess) return Result<Unit>.Fail(authorizer.Error);
        RoomMembership? observed = null;
        RoomMembership Departed()
            => new(agent.Principal.BackendUserId, "", "leave", observed?.NativeAccess ?? previous.NativeAccess);

        async ValueTask<Result<Unit>> Remove()
        {
            var rooms = await ports.Messaging.Joined(agent.Principal.BackendUserId, cancellation);
            if (!rooms.IsSuccess)
            {
                if (agent.Principal.Status == "revoked" || agent.Owner.Status == "revoked")
                {
                    var account = ports.Account(agentId);
                    if (account.IsSuccess && account.Value?.AppliedStatus == "revoked") { observed = Departed(); return Results.Done(); }
                }
                return Result<Unit>.Fail(rooms.Error);
            }
            if (rooms.Value.Contains(roomId, StringComparer.Ordinal))
            {
                var left = await ports.Messaging.Leave(agent.Principal.BackendUserId, roomId, cancellation);
                if (!left.IsSuccess) return left;
            }
            else if (grant.InvitationEventId is not null)
            {
                var invitation = await ports.Messaging.Invitation(agent.Principal.BackendUserId, roomId, cancellation);
                if (!invitation.IsSuccess) return Result<Unit>.Fail(invitation.Error);
                if (invitation.Value?.EventId == grant.InvitationEventId)
                {
                    var left = await ports.Messaging.Leave(agent.Principal.BackendUserId, roomId, cancellation);
                    if (!left.IsSuccess) return left;
                }
            }
            observed = Departed(); return Results.Done();
        }

        async ValueTask<Result<Unit>> ApplyNative()
        {
            if (grant.AccessMode == "none" || agent.Principal.Status != "active" || agent.Owner.Status != "active") return await Remove();
            if (repairDirect)
            {
                var repaired = await ports.Messaging.OwnerConversation(agent.Owner.BackendUserId, agent.Principal.BackendUserId, roomId, null, cancellation);
                if (!repaired.IsSuccess) return Result<Unit>.Fail(repaired.Error);
                if (repaired.Value != roomId) return Results.Fail<Unit>("conflict", "The owner DM changed during reconciliation");
            }
            if (authorizer.Value?.Status != "active")
            {
                var left = await Remove();
                return left.IsSuccess ? Results.Fail<Unit>("forbidden", "The grant authorizer is no longer active") : left;
            }
            if (authorizer.Value.Kind == "agent")
            {
                var inviter = ports.Grants.Authorization.AgentView(authorizer.Value.Id);
                if (!inviter.IsSuccess) return Result<Unit>.Fail(inviter.Error);
                var delegated = ports.Grants.Find(authorizer.Value.Id, roomId);
                if (!delegated.IsSuccess) return Result<Unit>.Fail(delegated.Error);
                var permissions = ports.Grants.Permissions(authorizer.Value.Id, roomId);
                if (!permissions.IsSuccess) return Result<Unit>.Fail(permissions.Error);
                if (inviter.Value is null || inviter.Value.Owner.Status != "active" || delegated.Value is null || delegated.Value.AccessMode == "none"
                    || !permissions.Value.Any(value => value.PermissionCode == "room.agent.invite" && value.Generation == delegated.Value.Generation))
                {
                    var left = await Remove();
                    return left.IsSuccess ? Results.Fail<Unit>("forbidden", "The inviting agent no longer has delegation for this room") : left;
                }
            }
            var native = await ports.Messaging.Membership(authorizer.Value.BackendUserId, agent.Principal.BackendUserId, roomId, cancellation);
            if (!native.IsSuccess) return Result<Unit>.Fail(native.Error);
            observed = native.Value;
            var command = repairDirect || previous.ObservedGeneration != grant.Generation || previous.AppliedAccessRevision != grant.AccessRevision;
            if (!command && native.Value.Membership != "join") return Results.Done();
            var admission = command ? grant.AdmissionKind == "managed" ? new RoomAdmission("managed")
                : new RoomAdmission("invitation", grant.InvitationEventId, authorizer.Value.BackendUserId) : null;
            var changed = await ports.Messaging.SetRoomAccess(authorizer.Value.BackendUserId, agent.Principal.BackendUserId, roomId,
                new(grant.AccessMode, grant.NativeAccess, grant.Muted), admission, cancellation);
            if (!changed.IsSuccess)
            {
                var left = await Remove(); return left.IsSuccess ? Result<Unit>.Fail(changed.Error) : left;
            }
            observed = changed.Value; return Results.Done();
        }

        var result = await ApplyNative();
        return ports.Grants.Transaction.Run(() =>
        {
            var current = ports.Grants.Find(agentId, roomId);
            if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
            var identity = ports.Grants.Authorization.AgentView(agentId);
            if (!identity.IsSuccess) return Result<Unit>.Fail(identity.Error);
            if (current.Value is null || current.Value.Generation != grant.Generation || current.Value.Revision != grant.Revision
                || identity.Value is null || identity.Value.Principal.Revision != agent.Principal.Revision || identity.Value.Owner.Revision != agent.Owner.Revision)
                return Results.Fail<Unit>("conflict", "Grant authority changed during native application");
            var currentAuthorizer = ports.Grants.Authorization.Principal(grant.AuthorizerId);
            if (!currentAuthorizer.IsSuccess) return Result<Unit>.Fail(currentAuthorizer.Error);
            if (currentAuthorizer.Value?.Revision != authorizer.Value?.Revision) return Results.Fail<Unit>("conflict", "Grant authorizer changed during native application");
            var next = previous with { LastAttemptAt = ports.Grants.Authorization.Now(), NextCheckAt = checked(ports.Grants.Authorization.Now() + policy.Value.ReconcileSeconds * 1000) };
            if (observed is not null) next = next with { Membership = observed.Membership, NativeAccess = observed.NativeAccess };
            next = result.IsSuccess ? next with { ObservedGeneration = grant.Generation, AppliedRevision = grant.Revision, AppliedAccessRevision = grant.AccessRevision,
                LastSuccessAt = ports.Grants.Authorization.Now(), ErrorCode = null, ErrorMessage = null }
                : next with { ErrorCode = result.Error.Code, ErrorMessage = result.Error.Message };
            return ports.Grants.SaveApplication(next);
        });
    }
}
