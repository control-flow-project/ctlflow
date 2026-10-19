using System.Text.Json;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record MemberSignup(string Username, string Password, JsonElement Native);
public sealed record MemberSignupClaim(string Id, string Secret);
public sealed record MemberRegistrationPorts(InvitationPorts Invitations, MessagingPorts Messaging, RoomOperation Operation,
    Func<string, Result<Principal?>> ByBackendUserId, Func<string, Result<MemberInvitation?>> ByClaim,
    Func<Principal, string, string?, string, Result<Unit>> Register, Func<long, Result<IReadOnlyList<MemberInvitation>>> AbandonedClaims);

public static class MemberRegistration
{
    public static async ValueTask<Result<BackendAccount>> Register(MemberRegistrationPorts ports, MemberSignup input, MemberSignupClaim? invitation, string requestId, CancellationToken cancellation = default)
    {
        var identity = ports.Messaging.RegistrationUserId(input);
        if (!identity.IsSuccess) return Result<BackendAccount>.Fail(identity.Error);
        var backendUserId = identity.Value;
        var output = Results.Fail<BackendAccount>("unavailable", "Registration did not execute");
        var result = await ports.Operation("registration:" + backendUserId, async token =>
        {
            output = invitation is null ? await Open(ports, input, backendUserId, requestId, token) : await Invited(ports, input, backendUserId, invitation, requestId, token);
            return output.Map(_ => default(Unit));
        }, cancellation);
        return result.IsSuccess ? output : Result<BackendAccount>.Fail(result.Error);
    }

    private static async ValueTask<Result<BackendAccount>> Open(MemberRegistrationPorts ports, MemberSignup input, string backendUserId, string requestId, CancellationToken cancellation)
    {
        var policy = ports.Invitations.Policy();
        if (!policy.IsSuccess) return Result<BackendAccount>.Fail(policy.Error);
        if (policy.Value?.SignupMode != "open") return Results.Fail<BackendAccount>("forbidden", "An invitation link is required to create an account");
        var exists = await ports.Messaging.Exists(backendUserId, cancellation);
        if (!exists.IsSuccess) return Result<BackendAccount>.Fail(exists.Error);
        if (exists.Value) return Results.Fail<BackendAccount>("conflict", "This username is already registered");
        var account = await ports.Messaging.Provision(backendUserId, input.Password, input.Native, cancellation);
        if (!account.IsSuccess) return account;
        var registered = ports.Invitations.Transaction.Run(() =>
        {
            var current = ports.Invitations.Policy();
            if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
            if (current.Value?.SignupMode != "open") return Results.Fail<Unit>("forbidden", "Open signup was disabled during registration");
            var existing = ports.ByBackendUserId(backendUserId);
            if (!existing.IsSuccess) return Result<Unit>.Fail(existing.Error);
            if (existing.Value is not null) return Results.Fail<Unit>("conflict", "This account is already registered");
            var principal = new Principal(Identity.Identifier(), backendUserId, "human", "active", 0, ports.Invitations.Authorization.Now());
            var saved = ports.Register(principal, "member", null, input.Username);
            return saved.IsSuccess ? ports.Invitations.Audit(new(requestId, "anonymous", null, principal.Id, "member", principal.Id, "member.register")) : saved;
        });
        if (registered.IsSuccess) return account;
        var discarded = await ports.Messaging.Discard(backendUserId, cancellation);
        return discarded.IsSuccess ? Result<BackendAccount>.Fail(registered.Error) : Results.Fail<BackendAccount>("native", "Registration could not finish; native account cleanup failed");
    }

    private static async ValueTask<Result<BackendAccount>> Invited(MemberRegistrationPorts ports, MemberSignup input, string backendUserId, MemberSignupClaim invitation, string requestId, CancellationToken cancellation)
    {
        var fingerprint = Identity.Hash("[" + string.Join(',', new[] { invitation.Secret, backendUserId, input.Password, input.Username }.Select(ProtocolJson.Quote)) + "]");
        var initial = ports.Invitations.Find(invitation.Id);
        if (!initial.IsSuccess) return Result<BackendAccount>.Fail(initial.Error);
        if (!Valid(ports, initial.Value, invitation.Secret)) return Results.Fail<BackendAccount>("unauthorized", "Invalid or expired invitation");
        if (initial.Value!.ConsumedByMemberId is not null)
            return initial.Value.ClaimFingerprint != fingerprint ? Results.Fail<BackendAccount>("conflict", "Invitation was consumed with different account details")
                : await ports.Messaging.Provision(backendUserId, input.Password, input.Native, cancellation);
        if (initial.Value.ClaimBackendUserId is null)
        {
            var exists = await ports.Messaging.Exists(backendUserId, cancellation);
            if (!exists.IsSuccess) return Result<BackendAccount>.Fail(exists.Error);
            if (exists.Value) return Results.Fail<BackendAccount>("conflict", "Native username is already registered");
        }
        var reserved = ports.Invitations.Transaction.Run(() =>
        {
            var current = ports.Invitations.Find(invitation.Id);
            if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
            if (!Valid(ports, current.Value, invitation.Secret) || current.Value!.ConsumedByMemberId is not null) return Results.Fail<Unit>("unauthorized", "Invitation is no longer usable");
            if (current.Value.ClaimBackendUserId is not null) return current.Value.ClaimFingerprint == fingerprint ? Results.Done() : Results.Fail<Unit>("conflict", "Invitation is reserved for different account details");
            var existing = ports.ByBackendUserId(backendUserId);
            if (!existing.IsSuccess) return Result<Unit>.Fail(existing.Error);
            var claimed = ports.ByClaim(backendUserId);
            if (!claimed.IsSuccess) return Result<Unit>.Fail(claimed.Error);
            return existing.Value is not null || claimed.Value is not null ? Results.Fail<Unit>("conflict", "Identity is already reserved or registered")
                : ports.Invitations.Update(current.Value with { ClaimBackendUserId = backendUserId, ClaimDisplayName = input.Username, ClaimFingerprint = fingerprint });
        });
        if (!reserved.IsSuccess) return Result<BackendAccount>.Fail(reserved.Error);
        var provisioned = await ports.Messaging.Provision(backendUserId, input.Password, input.Native, cancellation);
        if (!provisioned.IsSuccess) return provisioned;
        return ports.Invitations.Transaction.Run(() =>
        {
            var current = ports.Invitations.Find(invitation.Id);
            if (!current.IsSuccess) return Result<BackendAccount>.Fail(current.Error);
            if (current.Value is null || current.Value.RevokedAt is not null || current.Value.ExpiresAt <= ports.Invitations.Authorization.Now() || current.Value.ClaimFingerprint != fingerprint)
                return Results.Fail<BackendAccount>("conflict", "Invitation changed during native provisioning; cleanup is pending");
            if (current.Value.ConsumedByMemberId is not null) return provisioned;
            var principal = new Principal(Identity.Identifier(), backendUserId, "human", "active", 0, ports.Invitations.Authorization.Now());
            var registered = ports.Register(principal, current.Value.RoleCode, current.Value.CreatedByMemberId, input.Username);
            if (!registered.IsSuccess) return Result<BackendAccount>.Fail(registered.Error);
            var consumed = ports.Invitations.Update(current.Value with { ConsumedByMemberId = principal.Id });
            if (!consumed.IsSuccess) return Result<BackendAccount>.Fail(consumed.Error);
            return ports.Invitations.Audit(new(requestId, "anonymous", null, principal.Id, "member", principal.Id, "member-invitation.accept")).Map(_ => provisioned.Value);
        });
    }

    private static bool Valid(MemberRegistrationPorts ports, MemberInvitation? value, string secret)
        => value is { RevokedAt: null } && value.ExpiresAt > ports.Invitations.Authorization.Now() && Identity.Matches(secret, value.ClaimHash);

    public static async ValueTask<Result<Unit>> CleanClaims(MemberRegistrationPorts ports, CancellationToken cancellation = default)
    {
        var claims = ports.AbandonedClaims(ports.Invitations.Authorization.Now());
        if (!claims.IsSuccess) return Result<Unit>.Fail(claims.Error);
        foreach (var invitation in claims.Value)
        {
            cancellation.ThrowIfCancellationRequested();
            if (invitation.ClaimBackendUserId is null) continue;
            var removed = await ports.Messaging.Discard(invitation.ClaimBackendUserId, cancellation);
            if (!removed.IsSuccess) continue;
            var cleared = ports.Invitations.Transaction.Run(() =>
            {
                var current = ports.Invitations.Find(invitation.Id);
                if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
                return current.Value is null || current.Value.ConsumedByMemberId is not null || current.Value.ClaimFingerprint != invitation.ClaimFingerprint ? Results.Done()
                    : ports.Invitations.Update(current.Value with { ClaimBackendUserId = null, ClaimDisplayName = null, ClaimFingerprint = null });
            });
            if (!cleared.IsSuccess) return cleared;
        }
        return Results.Done();
    }

}
