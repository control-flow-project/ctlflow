using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.IdentityLinks;
using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Providers;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class IdentityExternalLinkAuditDetail : AuditDetail
{
    private IdentityExternalLinkAuditDetail()
    {
        ExternalLinkId = null!;
        ProviderId = null!;
        HumanAccountPrincipalId = null!;
    }

    public IdentityExternalLinkAuditDetail(
        ExternalLinkId externalLinkId,
        ProviderId providerId,
        HumanAccountId humanAccountPrincipalId,
        IdentityExternalLinkAuditAction action)
        : base(AuditDetailKind.IdentityExternalLink)
    {
        ExternalLinkId = externalLinkId.Value;
        ProviderId = providerId.Value;
        HumanAccountPrincipalId = humanAccountPrincipalId.Value;
        Action = (int)action;
    }

    internal string ExternalLinkId { get; private set; }
    internal string ProviderId { get; private set; }
    internal string HumanAccountPrincipalId { get; private set; }
    internal int Action { get; private set; }

    internal override void WriteCanonical(CanonicalHashWriter writer)
    {
        writer.Append(ExternalLinkId);
        writer.Append(ProviderId);
        writer.Append(HumanAccountPrincipalId);
        writer.Append(Action);
    }
}
