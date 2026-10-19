using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class RoomInvitations
{
    public static async ValueTask<Result<bool>> Accept(OwnerConversationPorts ports, Func<string, Result<Principal?>> byBackendUserId, Actor receiver, string agentId, string roomId, string requestId, CancellationToken cancellation = default)
    {
        var grants = ports.Reconciliation.Grants; var messaging = ports.Reconciliation.Messaging;
        var allowed = Authorization.Require(grants.Authorization, receiver, "room-invitation.accept.self"); if (!allowed.IsSuccess) return Result<bool>.Fail(allowed.Error);
        if (receiver.Kind != "agent" || receiver.PrincipalId != agentId) return Results.Fail<bool>("forbidden", "Only the invited agent may accept its invitation");
        var target = grants.Authorization.AgentView(agentId); if (!target.IsSuccess) return Result<bool>.Fail(target.Error);
        if (target.Value is null) return Results.Fail<bool>("missing", "Invited agent not found");
        var invitation = await messaging.Invitation(target.Value.Principal.BackendUserId, roomId, cancellation); if (!invitation.IsSuccess) return Result<bool>.Fail(invitation.Error);
        if (invitation.Value is null) return Result<bool>.Success(false);
        var bound = ports.Find(agentId); if (!bound.IsSuccess) return Result<bool>.Fail(bound.Error);
        if (invitation.Value.Direct && invitation.Value.SenderBackendUserId == target.Value.Owner.BackendUserId && (bound.Value is null || bound.Value.RoomId == roomId))
            return (await OwnerConversations.Ensure(ports, agentId, invitation.Value, cancellation)).Map(_ => true);
        var sender = byBackendUserId(invitation.Value.SenderBackendUserId); if (!sender.IsSuccess) return Result<bool>.Fail(sender.Error);
        if (sender.Value is null) return Results.Fail<bool>("forbidden", "The inviter is not a registered Crossfire identity");
        var existing = grants.Find(agentId, roomId); if (!existing.IsSuccess) return Result<bool>.Fail(existing.Error);
        if (existing.Value?.InvitationEventId == invitation.Value.EventId)
        { if (existing.Value.AccessMode == "none") return Results.Fail<bool>("forbidden", "This invitation was already withdrawn"); }
        else
        {
            var inviter = new Actor(sender.Value.Id, sender.Value.Kind, new NativeAuthentication(invitation.Value.SenderBackendUserId));
            var changed = await RoomGrantChanges.Change(grants, inviter, new(agentId, roomId, target.Value.Principal.Revision, existing.Value?.Generation, "reply", null, false), requestId, invitation.Value, cancellation);
            if (!changed.IsSuccess) return Result<bool>.Fail(changed.Error);
        }
        var applied = await RoomReconciliation.Reconcile(ports.Reconciliation, agentId, roomId, cancellation); if (!applied.IsSuccess) return Result<bool>.Fail(applied.Error);
        var observed = grants.Application(agentId, roomId); if (!observed.IsSuccess) return Result<bool>.Fail(observed.Error);
        if (observed.Value?.ErrorCode is { } code) return Results.Fail<bool>(code is "conflict" or "forbidden" ? code : "native", observed.Value.ErrorMessage ?? "Native invitation remains pending");
        var accepted = observed.Value?.Membership == "join";
        if (accepted && invitation.Value.Direct)
        {
            var marked = await messaging.MarkDirect(target.Value.Principal.BackendUserId, invitation.Value.SenderBackendUserId, roomId, cancellation); if (!marked.IsSuccess) return Result<bool>.Fail(marked.Error);
        }
        return Result<bool>.Success(accepted);
    }
}
