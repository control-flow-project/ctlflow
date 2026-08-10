using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Domain.Memberships;

public static partial class Memberships
{
    public static ValueTask<IdentityMutation<WorkspaceMember>>
        AddWorkspaceMember(
            Account? account,
            TenantMembership? tenantMembership,
            WorkspaceMembership? workspaceMembership,
            AccountId accountId,
            TenantId tenantId,
            WorkspaceId workspaceId,
            AuditContext audit,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (account is null || tenantMembership is null)
        {
            throw new IdentityPreconditionException();
        }

        if (workspaceMembership is not null)
        {
            return ValueTask.FromResult(
                new IdentityMutation<WorkspaceMember>(
                    new WorkspaceMember(account, workspaceMembership),
                    null));
        }

        workspaceMembership = new WorkspaceMembership(
            accountId,
            tenantId,
            workspaceId,
            Revision.Initial());
        return ValueTask.FromResult(
            new IdentityMutation<WorkspaceMember>(
                new WorkspaceMember(account, workspaceMembership),
                new MembershipAuditIntent(
                    AuditEventId.Generate(),
                    audit.Attribution,
                    tenantId,
                    workspaceId,
                    accountId,
                    workspaceMembership.Revision,
                    MembershipAuditAction.Added,
                    false,
                    audit.Correlation,
                    audit.OccurredAt)));
    }
}
