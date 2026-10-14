using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class EnrollmentQueries
{
    public static Result<EnrollmentRequest?> Find(CrossfireDbContext context, string id)
        => Stored.Read(() => context.EnrollmentRequest.AsNoTracking().Where(row => row.Id == id).Select(row => new EnrollmentRequest(row.Id, row.OwnerId,
            row.FleetKey, row.ControllerName, row.ControllerCredentialHash, row.VerificationCode, row.ClaimHash, row.RosterDigest,
            row.Status, row.Revision, row.CreatedAt, row.ExpiresAt, row.DecidedByMemberId, row.DecidedAt)).SingleOrDefault());

    public static Result<IReadOnlyList<EnrollmentRequest>> Expired(CrossfireDbContext context, long now)
        => Stored.Read<IReadOnlyList<EnrollmentRequest>>(() => context.EnrollmentRequest.AsNoTracking().Where(row => row.Status == "pending" && row.ExpiresAt <= now)
            .OrderBy(row => row.Id).Select(row => new EnrollmentRequest(row.Id, row.OwnerId, row.FleetKey, row.ControllerName, row.ControllerCredentialHash,
                row.VerificationCode, row.ClaimHash, row.RosterDigest, row.Status, row.Revision, row.CreatedAt, row.ExpiresAt, row.DecidedByMemberId, row.DecidedAt)).ToArray());

    public static Result<IReadOnlyList<EnrollmentItem>> Items(CrossfireDbContext context, string requestId)
        => Stored.Read<IReadOnlyList<EnrollmentItem>>(() => context.EnrollmentItem.AsNoTracking().Where(row => row.RequestId == requestId).OrderBy(row => row.InstanceKey)
            .Select(row => new EnrollmentItem(row.RequestId, row.InstanceKey, row.RequestedName, row.Outcome, row.AgentId)).ToArray());

    public static Result<long> PendingCount(CrossfireDbContext context)
        => Stored.Read(() => context.EnrollmentRequest.AsNoTracking().LongCount(row => row.Status == "pending"));

    public static Result<AgentCredential?> Credential(CrossfireDbContext context, string agentId)
        => Stored.Read(() => context.AgentCredential.AsNoTracking().Where(row => row.AgentId == agentId)
            .Select(row => new AgentCredential(row.AgentId, row.ProvisioningPassword, row.AccessToken, row.UpdatedAt)).SingleOrDefault());

    public static Result<IReadOnlyList<EnrollmentPolicy>> Policies(CrossfireDbContext context, string requestId)
    {
        var policies = Stored.Read(() => context.EnrollmentItemPolicy.AsNoTracking().Where(row => row.RequestId == requestId).OrderBy(row => row.InstanceKey).ToArray());
        if (!policies.IsSuccess) return Result<IReadOnlyList<EnrollmentPolicy>>.Fail(policies.Error);
        var senders = Stored.Read(() => context.EnrollmentItemWakeSender.AsNoTracking().Where(row => row.RequestId == requestId)
            .OrderBy(row => row.SenderPrincipalId).ToArray());
        if (!senders.IsSuccess) return Result<IReadOnlyList<EnrollmentPolicy>>.Fail(senders.Error);
        var permissions = Stored.Read(() => context.EnrollmentItemPermission.AsNoTracking().Where(row => row.RequestId == requestId).OrderBy(row => row.PermissionCode).ToArray());
        return permissions.Map<IReadOnlyList<EnrollmentPolicy>>(values => policies.Value.Select(policy => new EnrollmentPolicy(policy.InstanceKey,
            new(policy.WakeMode, senders.Value.Where(row => row.InstanceKey == policy.InstanceKey).Select(row => new WakeSelection(row.SenderPrincipalId, row.IncludeAgents == 1)).ToArray(),
                values.Where(row => row.InstanceKey == policy.InstanceKey).Select(row => row.PermissionCode).ToArray(), policy.ExpectedAgentRevision))).ToArray());
    }

    public static Result<IReadOnlyDictionary<string, string>> Metadata(CrossfireDbContext context, string requestId)
        => Stored.Read<IReadOnlyDictionary<string, string>>(() => context.EnrollmentControllerMetadata.AsNoTracking().Where(row => row.EnrollmentId == requestId)
            .OrderBy(row => row.Key).ToArray().ToDictionary(row => row.Key, row => row.Value, StringComparer.Ordinal));

    public static Result<Page<EnrollmentRequest>> List(CrossfireDbContext context, string? ownerId, int page, int size)
    {
        var count = Stored.Read(() => context.EnrollmentRequest.AsNoTracking().LongCount(row => ownerId == null || row.OwnerId == ownerId));
        if (!count.IsSuccess) return Result<Page<EnrollmentRequest>>.Fail(count.Error);
        var skip = checked((page - 1) * size);
        return Stored.Read(() => context.EnrollmentRequest.AsNoTracking().Where(row => ownerId == null || row.OwnerId == ownerId)
            .OrderByDescending(row => row.CreatedAt).ThenBy(row => row.Id).Skip(skip).Take(size).Select(row => new EnrollmentRequest(row.Id, row.OwnerId, row.FleetKey,
                row.ControllerName, row.ControllerCredentialHash, row.VerificationCode, row.ClaimHash, row.RosterDigest, row.Status, row.Revision, row.CreatedAt, row.ExpiresAt,
                row.DecidedByMemberId, row.DecidedAt)).ToArray()).Map(rows => new Page<EnrollmentRequest>(rows, page, size, count.Value));
    }
}
