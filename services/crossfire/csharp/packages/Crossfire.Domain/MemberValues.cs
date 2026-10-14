using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record PrincipalRole(string PrincipalId, string PrincipalKind, string RoleCode, string? AssignedByMemberId, long AssignedAt);
public sealed record PrincipalApplication(string PrincipalId, long? AppliedRevision, string? AppliedIntentHash, string? AppliedStatus,
    string? NativeDisplayName, long? LastAttemptAt, long? LastSuccessAt, long NextCheckAt, string? ErrorCode, string? ErrorMessage);
public sealed record MemberView(Principal Principal, Member Member, PrincipalRole Role, PrincipalApplication Application);
public sealed record Page<T>(IReadOnlyList<T> Items, int PageNumber, int PageSize, long TotalItems)
{
    public long TotalPages => Math.Max(1, TotalItems / PageSize + (TotalItems % PageSize == 0 ? 0 : 1));
}
public sealed record MemberChange(long ExpectedRevision, string? Status = null, string? DisplayName = null, string? RoleCode = null);
public sealed record MemberChanges(MemberView Before, MemberView After, bool NativeSelfName, long Now);
public sealed record InstancePolicy(string Id, long Revision, long MaxOwnerAgents, long MaxAgents, long MaxPending,
    long EnrollmentSeconds, long ReconcileSeconds, long MaxMessageBytes, long FleetIdleTimeoutSeconds,
    string AgentInstructions, string SignupMode, string InvitationIssuers);
public sealed record AuditIntent(string RequestId, string ActorKind, string? ActorPrincipalId, string? OwnerId,
    string TargetKind, string TargetId, string Action, string Outcome = "accepted", string Message = "",
    string? ActorCredentialId = null, string? RoomId = null, string? MembershipGeneration = null,
    string? AuthorizerId = null, string? AddedById = null, string? PermissionCode = null);

public interface UnitOfWork
{
    Result<T> Run<T>(Func<Result<T>> operation);
}

public sealed record MemberPorts(AuthorizationPorts Authorization, UnitOfWork Transaction,
    Func<string, Result<MemberView?>> Find, Func<int, int, Result<Page<MemberView>>> List,
    Func<Result<long>> ActiveAdministratorCount, Func<MemberChanges, Result<Unit>> Apply,
    Func<AuditIntent, Result<Unit>> Audit);

public sealed record PrincipalPorts(UnitOfWork Transaction, Func<string, Result<Principal?>> ByMatrixId,
    Func<Result<InstancePolicy?>> Policy, Func<InstancePolicy, Result<Unit>> AddPolicy,
    Func<Principal, PrincipalRole, PrincipalApplication, Member, Result<Unit>> Register,
    Func<long> Now, Func<string> Identifier);

public static class PrincipalValues
{
    public static PrincipalApplication Pending(string principalId, long now)
        => new(principalId, null, null, null, null, null, null, now, null, null);

    public static Result<Unit> Initialize(PrincipalPorts ports, string administratorMatrixId)
        => ports.Transaction.Run(() =>
        {
            var policy = ports.Policy();
            if (!policy.IsSuccess) return Result<Unit>.Fail(policy.Error);
            if (policy.Value is null)
            {
                var added = ports.AddPolicy(new("instance", 0, 10, 100, 100, 600, 300, 65536, 1800, "", "invitation", "administrators"));
                if (!added.IsSuccess) return added;
            }
            var existing = ports.ByMatrixId(administratorMatrixId);
            if (!existing.IsSuccess) return Result<Unit>.Fail(existing.Error);
            if (existing.Value is not null) return Results.Done();
            var id = ports.Identifier();
            var now = ports.Now();
            return ports.Register(new(id, administratorMatrixId, "human", "active", 0, now),
                new(id, "human", "administrator", null, now), Pending(id, now),
                new(id, "human", administratorMatrixId[1..administratorMatrixId.IndexOf(':')]));
        });
}
