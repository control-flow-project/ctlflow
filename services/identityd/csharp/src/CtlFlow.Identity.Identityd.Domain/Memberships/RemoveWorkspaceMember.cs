using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Domain.Memberships;

public static partial class Memberships
{
    public static ValueTask<IdentityRemoval> RemoveWorkspaceMember(
        WorkspaceMembership? membership,
        bool hasGroupMembership,
        AccountId accountId,
        TenantId tenantId,
        WorkspaceId workspaceId,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (membership is null)
        {
            return ValueTask.FromResult(new IdentityRemoval(null));
        }

        if (hasGroupMembership)
        {
            throw new IdentityPreconditionException();
        }

        return ValueTask.FromResult(
            new IdentityRemoval(
                new MembershipAuditIntent(
                    AuditEventId.Generate(),
                    audit.Attribution,
                    tenantId,
                    workspaceId,
                    accountId,
                    membership.Revision,
                    MembershipAuditAction.Removed,
                    false,
                    audit.Correlation,
                    audit.OccurredAt)));
    }
}
