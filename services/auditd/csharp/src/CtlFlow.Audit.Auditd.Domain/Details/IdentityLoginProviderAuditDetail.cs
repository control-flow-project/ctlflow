using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Providers;
using CtlFlow.Audit.Auditd.Domain.Resources;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class IdentityLoginProviderAuditDetail : AuditDetail
{
    private IdentityLoginProviderAuditDetail()
    {
        ProviderId = null!;
    }

    public IdentityLoginProviderAuditDetail(
        ProviderId providerId,
        Revision providerRevision,
        IdentityLoginProviderAuditState resultingState,
        IdentityLoginProviderAuditAction action)
        : base(AuditDetailKind.IdentityLoginProvider)
    {
        ProviderId = providerId.Value;
        ProviderRevision = providerRevision.Value;
        ResultingState = (int)resultingState;
        Action = (int)action;
    }

    internal string ProviderId { get; private set; }
    internal long ProviderRevision { get; private set; }
    internal int ResultingState { get; private set; }
    internal int Action { get; private set; }

    internal override void WriteCanonical(CanonicalHashWriter writer)
    {
        writer.Append(ProviderId);
        writer.Append(ProviderRevision);
        writer.Append(ResultingState);
        writer.Append(Action);
    }
}
