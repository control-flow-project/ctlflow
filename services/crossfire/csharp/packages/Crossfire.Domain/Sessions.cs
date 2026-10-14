using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record SessionCreation(string Secret, string CsrfSecret, MemberView Member, IReadOnlyList<string> Permissions);
public sealed record AuthenticatedMember(Actor Actor, MemberView Member, string CsrfSecret, IReadOnlyList<string> Permissions);
public sealed record SessionPorts(AuthorizationPorts Authorization, UnitOfWork Transaction,
    Func<string, CancellationToken, ValueTask<Result<string>>> Identify,
    Func<string, Result<Principal?>> ByMatrixId, Func<string, Result<MemberView?>> Member,
    Func<long, Result<Unit>> RemoveExpired, Func<string, long, Result<long>> Count,
    Func<MemberSession, Result<Unit>> Insert, Func<string, Result<Unit>> Remove,
    Func<string> Secret, Func<string, string> Hash);

public static class Sessions
{
    public static async ValueTask<Result<SessionCreation>> Create(SessionPorts ports, string token, CancellationToken cancellation = default)
    {
        var identity = await ports.Identify(token, cancellation);
        if (!identity.IsSuccess) return Result<SessionCreation>.Fail(identity.Error);
        return ports.Transaction.Run(() =>
        {
            var found = ports.ByMatrixId(identity.Value);
            if (!found.IsSuccess) return Result<SessionCreation>.Fail(found.Error);
            if (found.Value is not { Kind: "human", Status: "active" } principal)
                return Results.Fail<SessionCreation>("forbidden", "An active human membership is required");
            var member = ports.Member(principal.Id);
            if (!member.IsSuccess) return Result<SessionCreation>.Fail(member.Error);
            if (member.Value is null) return Results.Fail<SessionCreation>("forbidden", "An active human membership is required");
            var now = ports.Authorization.Now();
            var removed = ports.RemoveExpired(now);
            if (!removed.IsSuccess) return Result<SessionCreation>.Fail(removed.Error);
            var count = ports.Count(principal.Id, now);
            if (!count.IsSuccess) return Result<SessionCreation>.Fail(count.Error);
            if (count.Value >= 10) return Results.Fail<SessionCreation>("limit", "End an existing management session before opening another");
            var secret = ports.Secret();
            var csrf = ports.Secret();
            var saved = ports.Insert(new(ports.Hash(secret), principal.Id, csrf, token, now, checked(now + 28800000)));
            if (!saved.IsSuccess) return Result<SessionCreation>.Fail(saved.Error);
            var permissions = ports.Authorization.Permissions(principal.Id);
            return permissions.IsSuccess ? Result<SessionCreation>.Success(new(secret, csrf, member.Value, permissions.Value))
                : Result<SessionCreation>.Fail(permissions.Error);
        });
    }

    public static async ValueTask<Result<AuthenticatedMember>> Authenticate(SessionPorts ports, string secret, string? csrf = null, CancellationToken cancellation = default)
    {
        var session = ports.Authorization.Session(ports.Hash(secret));
        if (!session.IsSuccess) return Result<AuthenticatedMember>.Fail(session.Error);
        if (session.Value is null || session.Value.ExpiresAt <= ports.Authorization.Now())
            return Results.Fail<AuthenticatedMember>("unauthorized", "Management session expired or ended");
        if (csrf is not null && csrf != session.Value.CsrfSecret)
            return Results.Fail<AuthenticatedMember>("forbidden", "CSRF verification failed");
        var identity = await ports.Identify(session.Value.NativeAccessToken, cancellation);
        if (!identity.IsSuccess) return Result<AuthenticatedMember>.Fail(identity.Error);
        var member = ports.Member(session.Value.MemberId);
        if (!member.IsSuccess) return Result<AuthenticatedMember>.Fail(member.Error);
        if (member.Value is null || member.Value.Principal.MatrixUserId != identity.Value)
            return Results.Fail<AuthenticatedMember>("unauthorized", "Native session identity changed");
        var actor = new Actor(session.Value.MemberId, "human", new ManagementAuthentication(session.Value.SecretHash));
        var active = Authorization.ActiveActor(ports.Authorization, actor);
        if (!active.IsSuccess) return Result<AuthenticatedMember>.Fail(active.Error);
        var permissions = ports.Authorization.Permissions(actor.PrincipalId);
        return permissions.IsSuccess ? Result<AuthenticatedMember>.Success(new(actor, member.Value, session.Value.CsrfSecret, permissions.Value))
            : Result<AuthenticatedMember>.Fail(permissions.Error);
    }

    public static Result<Unit> End(SessionPorts ports, string secret) => ports.Remove(ports.Hash(secret));
}
