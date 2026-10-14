using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record RoomGrant(string AgentId, string RoomId, string Generation, string AuthorizerId, string AddedById,
    string? InvitationEventId, string AdmissionKind, string AccessMode, long? PowerLevel, bool Muted, long Revision, long AccessRevision, long UpdatedAt);
public sealed record RoomPermission(string AgentId, string RoomId, string Generation, string PermissionCode, string GrantScope, string GrantedByMemberId, long GrantedAt);
public sealed record RoomGrantApplication(string AgentId, string RoomId, string? ObservedGeneration, long? AppliedRevision, long? AppliedAccessRevision,
    string? Membership, bool Creator, long? PowerLevel, long? LastAttemptAt, long? LastSuccessAt, long NextCheckAt, string? ErrorCode, string? ErrorMessage);
public sealed record RoomInvitation(string RoomId, string SenderMatrixId, string EventId, bool Direct = false);
public sealed record GrantIntent(string AccessMode, long? PowerLevel, bool Muted);
public sealed record GrantChange(string AgentId, string RoomId, long ExpectedRevision, string? ExpectedGeneration, string AccessMode, long? PowerLevel, bool Muted);
public sealed record GrantProof(GrantChange Input, RoomGrant? Previous, long ActorRevision, long TargetRevision, long OwnerRevision,
    string? InviterGeneration, long? InviterRevision, string AuthorizerId, RoomFacts? Native, bool Changed, string? InvitationEventId, string AdmissionKind);
public sealed record GrantResult(RoomGrant? Grant, long Revision);
public sealed record PrivateConversation(string Kind, string? AgentId, string? OwnerId);
public sealed record RoomPolicy(string ApprovedByMemberId, IReadOnlyList<string> Permissions);
public sealed record RoomGrantPorts(AuthorizationPorts Authorization, UnitOfWork Transaction,
    Func<string, string, Result<RoomGrant?>> Find, Func<string, Result<IReadOnlyList<RoomGrant>>> Grants,
    Func<RoomGrant, bool, Result<Unit>> Save, Func<string, long, Result<Unit>> ReviseAgent,
    Func<string, Result<PrivateConversation?>> PrivateConversation,
    Func<string, Result<string?>> OwnerConversationRoom,
    Func<string, string, Result<IReadOnlyList<RoomPermission>>> Permissions,
    Func<string, string, IReadOnlyList<RoomPermission>, Result<Unit>> ReplacePermissions,
    Func<string, Result<RoomPolicy?>> FleetPolicy,
    Func<string, string, Result<RoomGrantApplication?>> Application, Func<RoomGrantApplication, Result<Unit>> SaveApplication,
    Func<string, string, CancellationToken, ValueTask<Result<RoomFacts>>> Room,
    Func<AuditIntent, Result<Unit>> Audit, Func<string> Identifier);

public static class RoomGrantValues
{
    public static bool Same(RoomGrant grant, GrantChange input)
        => grant.AccessMode == input.AccessMode && grant.PowerLevel == input.PowerLevel && grant.Muted == input.Muted;

    public static Result<long> Power(RoomFacts facts, GrantChange input)
    {
        var level = input.AccessMode == "read" ? facts.ReadLevel : input.AccessMode == "custom" ? input.PowerLevel : facts.ReplyLevel;
        if (level is null || level > 9007199254740991L || level < -9007199254740991L)
            return Results.Fail<long>("invalid", "A finite integer Matrix power level is required");
        return facts.Creator || level <= facts.PowerLevel ? Result<long>.Success(level.Value)
            : Results.Fail<long>("forbidden", "Requested access exceeds the authorizer’s native room permissions");
    }

    public static Result<Unit> Protect(RoomGrantPorts ports, GrantChange input)
    {
        var conversation = ports.PrivateConversation(input.RoomId);
        if (!conversation.IsSuccess) return Result<Unit>.Fail(conversation.Error);
        if (conversation.Value is null) return Results.Done();
        if (conversation.Value.Kind == "management" || conversation.Value.AgentId != input.AgentId)
            return Results.Fail<Unit>("forbidden", "Another agent cannot join a private owner DM");
        return input.AccessMode != "reply" || input.PowerLevel is not null || input.Muted
            ? Results.Fail<Unit>("forbidden", "Owner DMs always have read-and-reply access and cannot be muted or removed") : Results.Done();
    }
}
