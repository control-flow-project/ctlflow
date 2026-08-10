using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Groups;
using CtlFlow.Audit.Auditd.Domain.Workspaces;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class IdentityGroupAuditDetail : AuditDetail
{
    private IdentityGroupAuditDetail()
    {
        GroupId = null!;
    }

    public IdentityGroupAuditDetail(
        GroupId groupId,
        WorkspaceId? workspaceId,
        IdentityGroupAuditAction action)
        : base(AuditDetailKind.IdentityGroup)
    {
        GroupId = groupId.Value;
        WorkspaceId = workspaceId?.Value;
        Action = (int)action;
    }

    internal string GroupId { get; private set; }
    internal string? WorkspaceId { get; private set; }
    internal int Action { get; private set; }

    internal override void WriteCanonical(CanonicalHashWriter writer)
    {
        writer.Append(GroupId);
        writer.AppendOptional(WorkspaceId);
        writer.Append(Action);
    }
}
