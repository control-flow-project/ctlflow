using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Resources;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class TenantMutationAuditDetail : AuditDetail
{
    private TenantMutationAuditDetail()
    {
    }

    public TenantMutationAuditDetail(
        TenantAuditAction action,
        Revision resourceRevision,
        TenancyAuditState resultingState)
        : base(AuditDetailKind.TenantMutation)
    {
        Action = (int)action;
        ResourceRevision = resourceRevision.Value;
        ResultingState = (int)resultingState;
    }

    internal int Action { get; private set; }

    internal long ResourceRevision { get; private set; }

    internal int ResultingState { get; private set; }

    internal override void WriteCanonical(CanonicalHashWriter writer)
    {
        writer.Append(Action);
        writer.Append(ResourceRevision);
        writer.Append(ResultingState);
    }
}
