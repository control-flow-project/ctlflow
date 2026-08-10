using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Domain.Principals;

public static partial class Principals
{
    public static async ValueTask<IdentityMutation<VirtualPrincipal>>
        SetVirtualPrincipalEnabled(
            VirtualPrincipal? principal,
            IdentityTarget fence,
            Revision expectedRevision,
            bool enabled,
            AuditContext audit,
            CancellationToken cancellation)
    {
        principal = await RequireVirtualPrincipal(
            principal,
            fence,
            cancellation);
        if (principal.Revision != expectedRevision)
        {
            throw new IdentityRevisionConflictException();
        }

        if (principal.Enabled == enabled)
        {
            return new IdentityMutation<VirtualPrincipal>(principal, null);
        }

        principal.SetEnabled(enabled);
        return new IdentityMutation<VirtualPrincipal>(
            principal,
            new VirtualPrincipalAuditIntent(
                AuditEventId.Generate(),
                audit.Attribution,
                fence.TenantId,
                fence.WorkspaceId,
                principal.Id,
                principal.SubjectAccountId,
                principal.Revision,
                principal.Enabled,
                VirtualPrincipalAuditAction.EnabledStateChanged,
                audit.Correlation,
                audit.OccurredAt));
    }
}
