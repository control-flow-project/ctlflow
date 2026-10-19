using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record MemberInvitation(string Id, string CreatedByMemberId, string ClaimHash, string RoleCode, string PrincipalKind,
    long CreatedAt, long ExpiresAt, string? ConsumedByMemberId, long? RevokedAt, string? ClaimBackendUserId, string? ClaimDisplayName, string? ClaimFingerprint);
public sealed record InvitationCreation(string InvitationId, string ClaimSecret, long ExpiresAt);
public sealed record InvitationPorts(AuthorizationPorts Authorization, UnitOfWork Transaction, Func<Result<InstancePolicy?>> Policy,
    Func<string, Result<MemberInvitation?>> Find, Func<MemberInvitation, Result<Unit>> Insert, Func<MemberInvitation, Result<Unit>> Update,
    Func<int, int, string?, Result<Page<MemberInvitation>>> List, Func<AuditIntent, Result<Unit>> Audit,
    Func<string> Identifier, Func<string> Secret, Func<string, string> Hash, Func<string, string, bool> Matches);

public static class Invitations
{
    public static Result<bool> Authority(InvitationPorts ports, Actor actor)
    {
        var authorized = Authorization.Require(ports.Authorization, actor, "member.invite");
        if (!authorized.IsSuccess) return Result<bool>.Fail(authorized.Error);
        var permissions = ports.Authorization.Permissions(actor.PrincipalId);
        if (!permissions.IsSuccess) return Result<bool>.Fail(permissions.Error);
        var administrator = permissions.Value.Contains("member.manage", StringComparer.Ordinal);
        var policy = ports.Policy();
        return !policy.IsSuccess ? Result<bool>.Fail(policy.Error) : administrator || policy.Value?.InvitationIssuers == "members"
            ? Result<bool>.Success(administrator) : Results.Fail<bool>("forbidden", "Only administrators may invite members");
    }

    public static Result<InvitationCreation> Create(InvitationPorts ports, Actor actor, string role, long expiresSeconds, string requestId)
    {
        if (expiresSeconds is < 60 or > 604800) return Results.Fail<InvitationCreation>("invalid", "Invitation lifetime must be 60–604800 seconds");
        return ports.Transaction.Run(() =>
        {
            var authority = Authority(ports, actor);
            if (!authority.IsSuccess) return Result<InvitationCreation>.Fail(authority.Error);
            if (!authority.Value && role != "member") return Results.Fail<InvitationCreation>("forbidden", "Only administrators may invite administrators");
            var id = ports.Identifier(); var secret = ports.Secret(); var now = ports.Authorization.Now(); var expires = checked(now + expiresSeconds * 1000);
            var saved = ports.Insert(new(id, actor.PrincipalId, ports.Hash(secret), role, "human", now, expires, null, null, null, null, null));
            if (!saved.IsSuccess) return Result<InvitationCreation>.Fail(saved.Error);
            var audit = ports.Audit(new(requestId, actor.Kind, actor.PrincipalId, null, "member-invitation", id, "member-invitation.create"));
            return audit.IsSuccess ? Result<InvitationCreation>.Success(new(id, secret, expires)) : Result<InvitationCreation>.Fail(audit.Error);
        });
    }

    public static Result<MemberInvitation> Read(InvitationPorts ports, Actor actor, string id)
    {
        var authority = Authority(ports, actor);
        if (!authority.IsSuccess) return Result<MemberInvitation>.Fail(authority.Error);
        var found = ports.Find(id);
        return !found.IsSuccess ? Result<MemberInvitation>.Fail(found.Error) : found.Value is not null && (authority.Value || found.Value.CreatedByMemberId == actor.PrincipalId)
            ? Result<MemberInvitation>.Success(found.Value) : Results.Fail<MemberInvitation>("missing", "Invitation not found");
    }

    public static Result<Page<MemberInvitation>> List(InvitationPorts ports, Actor actor, int page, int pageSize)
    {
        var authority = Authority(ports, actor);
        return authority.IsSuccess ? ports.List(page, pageSize, authority.Value ? null : actor.PrincipalId) : Result<Page<MemberInvitation>>.Fail(authority.Error);
    }

    public static Result<Unit> Revoke(InvitationPorts ports, Actor actor, string id, string requestId)
        => ports.Transaction.Run(() =>
        {
            var found = Read(ports, actor, id);
            if (!found.IsSuccess) return Result<Unit>.Fail(found.Error);
            if (found.Value.ConsumedByMemberId is not null) return Results.Fail<Unit>("conflict", "Invitation is already consumed");
            var saved = ports.Update(found.Value with { RevokedAt = found.Value.RevokedAt ?? ports.Authorization.Now() });
            return saved.IsSuccess ? ports.Audit(new(requestId, actor.Kind, actor.PrincipalId, null, "member-invitation", id, "member-invitation.revoke")) : saved;
        });

    public static Result<MemberInvitation> Verify(InvitationPorts ports, string id, string secret)
    {
        var found = ports.Find(id);
        return !found.IsSuccess ? Result<MemberInvitation>.Fail(found.Error) : found.Value is { RevokedAt: null, ConsumedByMemberId: null } invitation
            && invitation.ExpiresAt > ports.Authorization.Now() && ports.Matches(secret, invitation.ClaimHash)
                ? Result<MemberInvitation>.Success(invitation) : Results.Fail<MemberInvitation>("unauthorized", "This invitation is invalid, expired or already used");
    }
}
