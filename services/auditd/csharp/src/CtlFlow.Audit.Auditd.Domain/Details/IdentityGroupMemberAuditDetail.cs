using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Groups;
using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Workspaces;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class IdentityGroupMemberAuditDetail : AuditDetail
{
    private IdentityGroupMemberAuditDetail()
    {
        GroupId = null!;
        PrincipalId = null!;
    }

    public IdentityGroupMemberAuditDetail(
        GroupId groupId,
        PrincipalId principalId,
        WorkspaceId? workspaceId,
        IdentityGroupMemberAuditAction action)
        : base(AuditDetailKind.IdentityGroupMember)
    {
        GroupId = groupId.Value;
        PrincipalId = principalId.Value;
        WorkspaceId = workspaceId?.Value;
        Action = (int)action;
    }

    internal string GroupId { get; private set; }
    internal string PrincipalId { get; private set; }
    internal string? WorkspaceId { get; private set; }
    internal int Action { get; private set; }

    internal override void WriteCanonical(CanonicalHashWriter writer)
    {
        writer.Append(GroupId);
        writer.Append(PrincipalId);
        writer.AppendOptional(WorkspaceId);
        writer.Append(Action);
    }
}
