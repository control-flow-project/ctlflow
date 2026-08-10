using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Domain.Principals;

public static partial class Principals
{
    public static ValueTask<IdentityMutation<VirtualPrincipal>>
        CreateVirtualPrincipal(
            VirtualPrincipal? existing,
            PrincipalFacts? subjectAccount,
            VirtualPrincipalId principalId,
            AccountId subjectAccountId,
            IdentityTarget fence,
            AuditContext audit,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (existing is not null)
        {
            throw new IdentityAlreadyExistsException();
        }

        if (subjectAccount is null
            || subjectAccount.SubjectAccountId != subjectAccountId
            || subjectAccount.PrincipalId.Value != subjectAccountId.Value
            || subjectAccount.PrincipalKind == PrincipalKind.Virtual)
        {
            throw new IdentityNotFoundException();
        }

        var principal = new VirtualPrincipal(
            principalId,
            subjectAccountId,
            fence.TenantId,
            fence.WorkspaceId,
            enabled: true,
            Revision.Initial());
        return ValueTask.FromResult(
            new IdentityMutation<VirtualPrincipal>(
                principal,
                new VirtualPrincipalAuditIntent(
                    AuditEventId.Generate(),
                    audit.Attribution,
                    fence.TenantId,
                    fence.WorkspaceId,
                    principalId,
                    subjectAccountId,
                    principal.Revision,
                    principal.Enabled,
                    VirtualPrincipalAuditAction.Created,
                    audit.Correlation,
                    audit.OccurredAt)));
    }
}
