using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Resources;
using CtlFlow.Audit.Auditd.Domain.Workspaces;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class IdentityVirtualPrincipalAuditDetail : AuditDetail
{
    private IdentityVirtualPrincipalAuditDetail()
    {
        PrincipalId = null!;
        AttachedAccountPrincipalId = null!;
    }

    public IdentityVirtualPrincipalAuditDetail(
        VirtualPrincipalId principalId,
        AccountId attachedAccountPrincipalId,
        WorkspaceId? workspaceId,
        Revision principalRevision,
        bool enabled,
        IdentityVirtualPrincipalAuditAction action)
        : base(AuditDetailKind.IdentityVirtualPrincipal)
    {
        PrincipalId = principalId.Value;
        AttachedAccountPrincipalId = attachedAccountPrincipalId.Value;
        WorkspaceId = workspaceId?.Value;
        PrincipalRevision = principalRevision.Value;
        Enabled = enabled;
        Action = (int)action;
    }

    internal string PrincipalId { get; private set; }
    internal string AttachedAccountPrincipalId { get; private set; }
    internal string? WorkspaceId { get; private set; }
    internal long PrincipalRevision { get; private set; }
    internal bool Enabled { get; private set; }
    internal int Action { get; private set; }

    internal override void WriteCanonical(CanonicalHashWriter writer)
    {
        writer.Append(PrincipalId);
        writer.Append(AttachedAccountPrincipalId);
        writer.AppendOptional(WorkspaceId);
        writer.Append(PrincipalRevision);
        writer.Append(Enabled ? 1 : 0);
        writer.Append(Action);
    }
}
