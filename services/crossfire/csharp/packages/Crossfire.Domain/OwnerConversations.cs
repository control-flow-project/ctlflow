using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record OwnerConversation(string AgentId, string OwnerId, string RoomId, long CreatedAt);
public sealed record OwnerConversationPorts(RoomReconcilePorts Reconciliation,
    Func<string, Result<OwnerConversation?>> Find, Func<OwnerConversation, Result<Unit>> Insert);

public static class OwnerConversations
{
    public static async ValueTask<Result<string>> Ensure(OwnerConversationPorts ports, string agentId, RoomInvitation? invitation = null, CancellationToken cancellation = default)
    {
        var output = Results.Fail<string>("unavailable", "Owner conversation operation was not executed");
        var operated = await ports.Reconciliation.Operation("agent:" + agentId, async token =>
        {
            output = await Apply(ports, agentId, invitation, token);
            return output.Map(_ => default(Unit));
        }, cancellation);
        return operated.IsSuccess ? output : Result<string>.Fail(operated.Error);
    }

    private static async ValueTask<Result<string>> Apply(OwnerConversationPorts ports, string agentId, RoomInvitation? invitation, CancellationToken cancellation)
    {
        var grants = ports.Reconciliation.Grants; var matrix = ports.Reconciliation.Matrix;
        var target = grants.Authorization.AgentView(agentId);
        if (!target.IsSuccess) return Result<string>.Fail(target.Error);
        var previous = ports.Find(agentId);
        if (!previous.IsSuccess) return Result<string>.Fail(previous.Error);
        if (target.Value is null) return Results.Fail<string>("missing", "Agent not found");
        var identity = target.Value;
        if (identity.Principal.Status != "active" || identity.Owner.Status != "active") return Results.Fail<string>("forbidden", "Agent and owner must be active");
        if (identity.Application.AppliedStatus != "active" || identity.Application.ErrorCode is not null) return Results.Fail<string>("unavailable", "The native agent account is not ready");
        if (invitation is not null && (!invitation.Direct || invitation.SenderMatrixId != identity.Owner.MatrixUserId
            || previous.Value is not null && previous.Value.RoomId != invitation.RoomId))
            return Results.Fail<string>("conflict", "The invitation does not identify this agent’s private owner conversation");
        var checkedInvitation = await VerifyInvitation(matrix, identity, invitation, cancellation);
        if (!checkedInvitation.IsSuccess) return Result<string>.Fail(checkedInvitation.Error);
        string roomId;
        if (invitation is not null)
        {
            var verified = await matrix.VerifyOwnerConversation(identity.Owner.MatrixUserId, identity.Principal.MatrixUserId, invitation.RoomId, cancellation);
            if (!verified.IsSuccess) return Result<string>.Fail(verified.Error);
            roomId = invitation.RoomId;
        }
        else
        {
            var native = await matrix.OwnerConversation(identity.Owner.MatrixUserId, identity.Principal.MatrixUserId, previous.Value?.RoomId, null, cancellation);
            if (!native.IsSuccess) return Result<string>.Fail(native.Error);
            roomId = native.Value;
        }
        if (previous.Value is not null && (previous.Value.OwnerId != identity.Owner.Id || previous.Value.RoomId != roomId))
            return Results.Fail<string>("conflict", "The native owner conversation changed");
        var grant = grants.Find(agentId, roomId);
        if (!grant.IsSuccess) return Result<string>.Fail(grant.Error);
        var actor = new Actor(identity.Owner.Id, "human", new NativeAuthentication(identity.Owner.MatrixUserId));
        var proof = await RoomGrantAuthorization.Authorize(grants, actor,
            new(agentId, roomId, identity.Principal.Revision, grant.Value?.Generation, "reply", null, false), invitation, cancellation);
        if (!proof.IsSuccess) return Result<string>.Fail(proof.Error);
        checkedInvitation = await VerifyInvitation(matrix, identity, invitation, cancellation);
        if (!checkedInvitation.IsSuccess) return Result<string>.Fail(checkedInvitation.Error);
        var saved = grants.Transaction.Run(() => Commit(ports, actor, identity, previous.Value, proof.Value));
        if (!saved.IsSuccess) return Result<string>.Fail(saved.Error);
        var applied = await RoomReconciliation.Reconcile(ports.Reconciliation, agentId, roomId, cancellation);
        if (!applied.IsSuccess) return Result<string>.Fail(applied.Error);
        var observation = grants.Application(agentId, roomId);
        if (!observation.IsSuccess) return Result<string>.Fail(observation.Error);
        if (observation.Value?.Membership != "join" || observation.Value.ErrorCode is not null)
            return Results.Fail<string>("unavailable", observation.Value?.ErrorMessage ?? "Owner conversation read and reply is not ready");
        var marked = await matrix.OwnerConversation(identity.Owner.MatrixUserId, identity.Principal.MatrixUserId, roomId, null, cancellation);
        if (!marked.IsSuccess) return Result<string>.Fail(marked.Error);
        if (marked.Value != roomId) return Results.Fail<string>("conflict", "The native owner conversation changed");
        return grants.Transaction.Run(() =>
        {
            var current = grants.Authorization.AgentView(agentId);
            if (!current.IsSuccess) return Result<string>.Fail(current.Error);
            var bound = ports.Find(agentId);
            if (!bound.IsSuccess) return Result<string>.Fail(bound.Error);
            var currentGrant = grants.Find(agentId, roomId);
            if (!currentGrant.IsSuccess) return Result<string>.Fail(currentGrant.Error);
            return current.Value is null || current.Value.Principal.Revision != saved.Value.Revision || current.Value.Owner.Revision != identity.Owner.Revision
                || currentGrant.Value?.Generation != saved.Value.Grant?.Generation || currentGrant.Value?.Revision != saved.Value.Grant?.Revision
                || bound.Value?.RoomId != roomId || bound.Value.OwnerId != identity.Owner.Id
                ? Results.Fail<string>("conflict", "Owner conversation authority changed during native application") : Result<string>.Success(roomId);
        });
    }

    private static async ValueTask<Result<Unit>> VerifyInvitation(MatrixPorts matrix, AgentView identity, RoomInvitation? invitation, CancellationToken cancellation)
    {
        if (invitation is null) return Results.Done();
        var current = await matrix.Invitation(identity.Principal.MatrixUserId, invitation.RoomId, cancellation);
        if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
        return current.Value is null || !current.Value.Direct || current.Value.EventId != invitation.EventId || current.Value.SenderMatrixId != invitation.SenderMatrixId
            ? Results.Fail<Unit>("conflict", "The owner DM invitation was withdrawn or replaced") : Results.Done();
    }

    private static Result<GrantResult> Commit(OwnerConversationPorts ports, Actor actor, AgentView identity, OwnerConversation? previous, GrantProof proof)
    {
        var grants = ports.Reconciliation.Grants; var input = proof.Input;
        var rechecked = RoomGrantAuthorization.Recheck(grants, actor, proof);
        if (!rechecked.IsSuccess) return Result<GrantResult>.Fail(rechecked.Error);
        var bound = ports.Find(identity.Principal.Id);
        if (!bound.IsSuccess) return Result<GrantResult>.Fail(bound.Error);
        if (bound.Value?.RoomId != previous?.RoomId) return Results.Fail<GrantResult>("conflict", "Owner conversation changed during native application");
        var committed = RoomGrantChanges.Commit(grants, actor, proof, Identity.Identifier(), "owner-conversation");
        if (!committed.IsSuccess) return Result<GrantResult>.Fail(committed.Error);
        if (committed.Value is null || committed.Value.AuthorizerId != identity.Owner.Id || committed.Value.AddedById != identity.Owner.Id)
            return Results.Fail<GrantResult>("forbidden", "Owner conversation provenance does not match");
        var value = committed.Value;
        var permissions = grants.Permissions(input.AgentId, input.RoomId);
        if (!permissions.IsSuccess) return Result<GrantResult>.Fail(permissions.Error);
        var removed = grants.ReplacePermissions(input.AgentId, input.RoomId, []);
        if (!removed.IsSuccess) return Result<GrantResult>.Fail(removed.Error);
        if (permissions.Value.Count != 0)
        {
            value = value with { Revision = checked(value.Revision + 1), UpdatedAt = grants.Authorization.Now() };
            var changed = grants.Save(value, false);
            if (!changed.IsSuccess) return Result<GrantResult>.Fail(changed.Error);
            var audited = grants.Audit(new(Identity.Identifier(), actor.Kind, actor.PrincipalId, identity.Owner.Id, "agent", input.AgentId, "owner-conversation.ensure", RoomId: input.RoomId));
            if (!audited.IsSuccess) return Result<GrantResult>.Fail(audited.Error);
        }
        if (bound.Value is null)
        {
            var claimed = ports.Insert(new(input.AgentId, identity.Owner.Id, input.RoomId, grants.Authorization.Now()));
            if (!claimed.IsSuccess) return Result<GrantResult>.Fail(claimed.Error);
        }
        var revision = identity.Principal.Revision;
        if (proof.Changed || permissions.Value.Count != 0)
        {
            revision = checked(revision + 1);
            var revised = grants.ReviseAgent(input.AgentId, revision);
            if (!revised.IsSuccess) return Result<GrantResult>.Fail(revised.Error);
        }
        return Result<GrantResult>.Success(new(value, revision));
    }
}
