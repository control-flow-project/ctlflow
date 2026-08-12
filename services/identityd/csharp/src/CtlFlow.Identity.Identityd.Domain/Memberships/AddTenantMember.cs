using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;

namespace CtlFlow.Identity.Identityd.Domain.Memberships;

public static partial class Memberships
{
    public static ValueTask<IdentityMutation<TenantMember>> AddTenantMember(
        Account? account,
        TenantMembership? membership,
        AccountId accountId,
        TenantId tenantId,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var accountCreated = account is null;
        account ??= new Account(accountId, enabled: true, Revision.Initial());
        if (membership is not null)
        {
            return ValueTask.FromResult(
                new IdentityMutation<TenantMember>(
                    new TenantMember(account, membership),
                    null));
        }

        membership = new TenantMembership(
            accountId,
            tenantId,
            Revision.Initial());
        return ValueTask.FromResult(
            new IdentityMutation<TenantMember>(
                new TenantMember(account, membership),
                new MembershipAuditIntent(
                    AuditEventId.Generate(),
                    audit.Attribution,
                    tenantId,
                    null,
                    accountId,
                    membership.Revision,
                    MembershipAuditAction.Added,
                    accountCreated,
                    audit.Correlation,
                    audit.OccurredAt)));
    }
}
