using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Tenants;

namespace CtlFlow.Identity.Identityd.Domain.Memberships;

public static partial class Memberships
{
    public static ValueTask<IdentityRemoval> RemoveTenantMember(
        TenantMembership? membership,
        bool hasWorkspaceMembership,
        bool hasGroupMembership,
        bool hasExternalIdentityLink,
        AccountId accountId,
        TenantId tenantId,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (membership is null)
        {
            return ValueTask.FromResult(new IdentityRemoval(null));
        }

        if (hasWorkspaceMembership
            || hasGroupMembership
            || hasExternalIdentityLink)
        {
            throw new IdentityPreconditionException();
        }

        return ValueTask.FromResult(
            new IdentityRemoval(
                new MembershipAuditIntent(
                    AuditEventId.Generate(),
                    audit.Attribution,
                    tenantId,
                    null,
                    accountId,
                    membership.Revision,
                    MembershipAuditAction.Removed,
                    false,
                    audit.Correlation,
                    audit.OccurredAt)));
    }
}
