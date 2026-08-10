using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Domain.Groups;

public static partial class Groups
{
    public static ValueTask<IdentityRemoval> DeleteGroup(
        Group? existing,
        GroupId groupId,
        IdentityTarget target,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (existing is null)
        {
            return ValueTask.FromResult(new IdentityRemoval(null));
        }

        if (existing.TenantId != target.TenantId
            || existing.WorkspaceId != target.WorkspaceId)
        {
            throw new IdentityNotFoundException();
        }

        return ValueTask.FromResult(
            new IdentityRemoval(
                new GroupAuditIntent(
                    AuditEventId.Generate(),
                    audit.Attribution,
                    target.TenantId,
                    target.WorkspaceId,
                    groupId,
                    GroupAuditAction.Deleted,
                    audit.Correlation,
                    audit.OccurredAt)));
    }
}
