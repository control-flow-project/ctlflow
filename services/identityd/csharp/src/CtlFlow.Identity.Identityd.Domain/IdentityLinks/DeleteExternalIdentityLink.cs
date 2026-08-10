using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Mutations;

namespace CtlFlow.Identity.Identityd.Domain.IdentityLinks;

public static partial class ExternalIdentityLinks
{
    public static ValueTask<IdentityRemoval> DeleteExternalIdentityLink(
        ExternalIdentityLink? existing,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            new IdentityRemoval(
                existing is null
                    ? null
                    : new ExternalLinkAuditIntent(
                        AuditEventId.Generate(),
                        audit.Attribution,
                        existing.TenantId,
                        existing.ProviderId,
                        existing.AccountId,
                        ExternalLinkAuditAction.Deleted,
                        audit.Correlation,
                        audit.OccurredAt)));
    }
}
