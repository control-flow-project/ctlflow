using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Resources;
using CtlFlow.Audit.Auditd.Domain.Workspaces;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class WorkspaceMutationAuditDetail : AuditDetail
{
    private WorkspaceMutationAuditDetail()
    {
        WorkspaceId = null!;
    }

    public WorkspaceMutationAuditDetail(
        WorkspaceId workspaceId,
        WorkspaceAuditAction action,
        Revision resourceRevision,
        TenancyAuditState resultingState)
        : base(AuditDetailKind.WorkspaceMutation)
    {
        WorkspaceId = workspaceId.Value;
        Action = (int)action;
        ResourceRevision = resourceRevision.Value;
        ResultingState = (int)resultingState;
    }

    internal string WorkspaceId { get; private set; }

    internal int Action { get; private set; }

    internal long ResourceRevision { get; private set; }

    internal int ResultingState { get; private set; }

    internal override void WriteCanonical(CanonicalHashWriter writer)
    {
        writer.Append(WorkspaceId);
        writer.Append(Action);
        writer.Append(ResourceRevision);
        writer.Append(ResultingState);
    }
}
