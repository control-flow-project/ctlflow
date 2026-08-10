using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Domain.Groups;

public static partial class Groups
{
    public static ValueTask<IdentityRemoval> RemoveGroupMember(
        Group? group,
        bool membershipExists,
        GroupId groupId,
        PrincipalId principalId,
        IdentityTarget target,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (group is null
            || group.TenantId != target.TenantId
            || group.WorkspaceId != target.WorkspaceId)
        {
            throw new IdentityNotFoundException();
        }

        return ValueTask.FromResult(
            new IdentityRemoval(
                membershipExists
                    ? new GroupMemberAuditIntent(
                        AuditEventId.Generate(),
                        audit.Attribution,
                        target.TenantId,
                        target.WorkspaceId,
                        groupId,
                        principalId,
                        GroupMemberAuditAction.Removed,
                        audit.Correlation,
                        audit.OccurredAt)
                    : null));
    }
}
