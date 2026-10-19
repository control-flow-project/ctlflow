using System.Text;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record PrincipalApplyPorts(AuthorizationPorts Authorization, UnitOfWork Transaction, MessagingPorts Messaging, RoomOperation Operation,
    Func<Result<InstancePolicy?>> Policy, Func<string, Result<MemberView?>> Member, Func<string, Result<PrincipalApplication?>> Application,
    Func<PrincipalApplication, Result<Unit>> SaveApplication, Func<string, Result<AgentCredential?>> Credential, Func<AgentCredential, Result<Unit>> SaveCredential,
    RoomGrantPorts Rooms);
public sealed record PrincipalNativeIntent(Principal Principal, PrincipalApplication Application, string Status, string DisplayName, Principal? Owner, string? Token);

public static class PrincipalApplications
{
    public static string Hash(string backendUserId, string status, string displayName)
    {
        var text = new StringBuilder("{\"backendUserId\":"); ProtocolJson.String(text, backendUserId);
        text.Append(",\"status\":"); ProtocolJson.String(text, status);
        text.Append(",\"displayName\":"); ProtocolJson.String(text, displayName);
        return Identity.Hash(text.Append('}').ToString());
    }

    public static Result<PrincipalNativeIntent> Intent(PrincipalApplyPorts ports, string principalId)
    {
        var found = ports.Authorization.Principal(principalId);
        if (!found.IsSuccess) return Result<PrincipalNativeIntent>.Fail(found.Error);
        var application = ports.Application(principalId);
        if (!application.IsSuccess) return Result<PrincipalNativeIntent>.Fail(application.Error);
        if (found.Value is null || application.Value is null) return Results.Fail<PrincipalNativeIntent>("missing", "Principal reconciliation state is missing");
        var principal = found.Value;
        if (principal.Kind == "agent")
        {
            var agent = ports.Authorization.AgentView(principalId);
            if (!agent.IsSuccess) return Result<PrincipalNativeIntent>.Fail(agent.Error);
            if (agent.Value is null) return Results.Fail<PrincipalNativeIntent>("missing", "Agent not found");
            var credentials = ports.Credential(principalId);
            if (!credentials.IsSuccess) return Result<PrincipalNativeIntent>.Fail(credentials.Error);
            if (credentials.Value is null) return Results.Fail<PrincipalNativeIntent>("missing", "Agent credentials are missing");
            var status = agent.Value.Owner.Status == "revoked" ? "revoked" : agent.Value.Owner.Status != "active" && principal.Status == "active" ? "suspended" : principal.Status;
            return Result<PrincipalNativeIntent>.Success(new(principal, application.Value, status, agent.Value.Name + " (" + agent.Value.OwnerMember.DisplayName + ")",
                agent.Value.Owner, credentials.Value.AccessToken));
        }
        var member = ports.Member(principalId);
        return !member.IsSuccess ? Result<PrincipalNativeIntent>.Fail(member.Error)
            : member.Value is null ? Results.Fail<PrincipalNativeIntent>("missing", "Member not found")
            : Result<PrincipalNativeIntent>.Success(new(principal, application.Value, principal.Status, member.Value.Member.DisplayName, null, null));
    }

    public static ValueTask<Result<Unit>> Reconcile(PrincipalApplyPorts ports, string principalId, CancellationToken cancellation = default)
        => ports.Operation("agent:" + principalId, async token =>
        {
            var intent = Intent(ports, principalId);
            if (!intent.IsSuccess) return Result<Unit>.Fail(intent.Error);
            var policy = ports.Policy();
            if (!policy.IsSuccess) return Result<Unit>.Fail(policy.Error);
            if (policy.Value is null) return Results.Fail<Unit>("missing", "Principal reconciliation policy is missing");
            var result = await ApplyNative(ports, intent.Value, token);
            var next = checked(ports.Authorization.Now() + policy.Value.ReconcileSeconds * 1000);
            return ports.Transaction.Run(() => Save(ports, intent.Value, result, next));
        }, cancellation);

    private static async ValueTask<Result<string?>> ApplyNative(PrincipalApplyPorts ports, PrincipalNativeIntent intent, CancellationToken cancellation)
    {
        var principal = intent.Principal; var token = intent.Token;
        if (intent.Status == "revoked")
        {
            var present = await ports.Messaging.Exists(principal.BackendUserId, cancellation);
            if (!present.IsSuccess) return Result<string?>.Fail(present.Error);
            if (!present.Value) return Result<string?>.Success(null);
            return (await ports.Messaging.Deactivate(principal.BackendUserId, cancellation)).Map<string?>(_ => null);
        }
        if (principal.Kind == "agent")
        {
            var valid = token is null ? Result<string>.Success("") : await ports.Messaging.Identify(token, cancellation);
            if (!valid.IsSuccess || valid.Value != principal.BackendUserId)
            {
                var credential = ports.Credential(principal.Id);
                if (!credential.IsSuccess) return Result<string?>.Fail(credential.Error);
                if (credential.Value is null) return Results.Fail<string?>("missing", "Agent credentials are missing");
                var account = await ports.Messaging.Provision(principal.BackendUserId, credential.Value.ProvisioningPassword, null, cancellation);
                if (!account.IsSuccess) return Result<string?>.Fail(account.Error);
                token = account.Value.AccessToken;
            }
        }
        var rooms = await ports.Messaging.Joined(principal.BackendUserId, cancellation);
        if (!rooms.IsSuccess) return Result<string?>.Fail(rooms.Error);
        var grants = principal.Kind == "agent" ? ports.Rooms.Grants(principal.Id) : Result<IReadOnlyList<RoomGrant>>.Success([]);
        if (!grants.IsSuccess) return Result<string?>.Fail(grants.Error);
        foreach (var room in rooms.Value)
        {
            if (intent.Status == "active" && (principal.Kind != "agent" || grants.Value.Any(grant => grant.RoomId == room && grant.AccessMode != "none"))) continue;
            var left = await ports.Messaging.Leave(principal.BackendUserId, room, cancellation);
            if (!left.IsSuccess) return Result<string?>.Fail(left.Error);
        }
        if (intent.Application.AppliedIntentHash != Hash(principal.BackendUserId, intent.Status, intent.DisplayName))
        {
            var named = await ports.Messaging.SetDisplayName(principal.BackendUserId, intent.DisplayName, cancellation);
            if (!named.IsSuccess) return Result<string?>.Fail(named.Error);
            if (intent.Owner is not null && intent.Application.NativeDisplayName != intent.DisplayName)
            {
                var conversation = ports.Rooms.OwnerConversationRoom(principal.Id);
                if (!conversation.IsSuccess) return Result<string?>.Fail(conversation.Error);
                if (conversation.Value is not null)
                {
                    var updated = await ports.Messaging.OwnerConversation(intent.Owner.BackendUserId, principal.BackendUserId, conversation.Value, intent.Application.NativeDisplayName, cancellation);
                    if (!updated.IsSuccess) return Result<string?>.Fail(updated.Error);
                    if (updated.Value != conversation.Value) return Results.Fail<string?>("conflict", "Owner conversation changed during renaming");
                }
            }
        }
        return Result<string?>.Success(token);
    }

    private static Result<Unit> Save(PrincipalApplyPorts ports, PrincipalNativeIntent intent, Result<string?> result, long nextCheckAt)
    {
        var current = ports.Authorization.Principal(intent.Principal.Id);
        if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
        if (current.Value?.Revision != intent.Principal.Revision) return Results.Fail<Unit>("conflict", "Principal changed during native application");
        if (intent.Owner is not null)
        {
            var owner = ports.Authorization.Principal(intent.Owner.Id);
            if (!owner.IsSuccess) return Result<Unit>.Fail(owner.Error);
            if (owner.Value?.Revision != intent.Owner.Revision) return Results.Fail<Unit>("conflict", "Owner changed during native application");
        }
        var now = ports.Authorization.Now();
        if (intent.Principal.Kind == "agent" && result.IsSuccess)
        {
            var credential = ports.Credential(intent.Principal.Id);
            if (!credential.IsSuccess) return Result<Unit>.Fail(credential.Error);
            if (credential.Value is null) return Results.Fail<Unit>("missing", "Agent credentials are missing");
            var saved = ports.SaveCredential(credential.Value with { AccessToken = result.Value, UpdatedAt = now });
            if (!saved.IsSuccess) return saved;
        }
        var application = intent.Application with { LastAttemptAt = now, NextCheckAt = nextCheckAt };
        application = result.IsSuccess ? application with { AppliedRevision = intent.Principal.Revision, AppliedIntentHash = Hash(intent.Principal.BackendUserId, intent.Status, intent.DisplayName),
            AppliedStatus = intent.Status, NativeDisplayName = intent.DisplayName, LastSuccessAt = now, ErrorCode = null, ErrorMessage = null }
            : application with { ErrorCode = result.Error.Code, ErrorMessage = result.Error.Message };
        return ports.SaveApplication(application);
    }
}
