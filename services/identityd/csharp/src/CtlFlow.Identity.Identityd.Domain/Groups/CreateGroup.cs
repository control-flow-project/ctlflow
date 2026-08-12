using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Domain.Groups;

public static partial class Groups
{
    public static ValueTask<IdentityMutation<Group>> CreateGroup(
        Group? existing,
        GroupId groupId,
        IdentityTarget target,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (existing is not null)
        {
            if (existing.TenantId != target.TenantId
                || existing.WorkspaceId != target.WorkspaceId)
            {
                throw new IdentityAlreadyExistsException();
            }

            return ValueTask.FromResult(
                new IdentityMutation<Group>(existing, null));
        }

        var group = new Group(groupId, target.TenantId, target.WorkspaceId);
        return ValueTask.FromResult(
            new IdentityMutation<Group>(
                group,
                new GroupAuditIntent(
                    AuditEventId.Generate(),
                    audit.Attribution,
                    target.TenantId,
                    target.WorkspaceId,
                    groupId,
                    GroupAuditAction.Created,
                    audit.Correlation,
                    audit.OccurredAt)));
    }
}
