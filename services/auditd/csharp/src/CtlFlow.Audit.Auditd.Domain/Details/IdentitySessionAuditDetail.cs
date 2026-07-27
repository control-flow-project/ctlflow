using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Resources;
using CtlFlow.Audit.Auditd.Domain.Sessions;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class IdentitySessionAuditDetail : AuditDetail
{
    private IdentitySessionAuditDetail()
    {
        SessionId = null!;
        HumanAccountPrincipalId = null!;
    }

    public IdentitySessionAuditDetail(
        SessionId sessionId,
        HumanAccountId humanAccountPrincipalId,
        Revision sessionRevision,
        IdentitySessionAuditAction action)
        : base(AuditDetailKind.IdentitySession)
    {
        SessionId = sessionId.Value;
        HumanAccountPrincipalId = humanAccountPrincipalId.Value;
        SessionRevision = sessionRevision.Value;
        Action = (int)action;
    }

    internal string SessionId { get; private set; }

    internal string HumanAccountPrincipalId { get; private set; }

    internal long SessionRevision { get; private set; }

    internal int Action { get; private set; }

    internal override void WriteCanonical(CanonicalHashWriter writer)
    {
        writer.Append(SessionId);
        writer.Append(HumanAccountPrincipalId);
        writer.Append(SessionRevision);
        writer.Append(Action);
    }
}
