using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Resources;
using CtlFlow.Audit.Auditd.Domain.Workspaces;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class IdentityMembershipAuditDetail : AuditDetail
{
    private IdentityMembershipAuditDetail()
    {
        AccountPrincipalId = null!;
    }

    public IdentityMembershipAuditDetail(
        AccountId accountPrincipalId,
        WorkspaceId? workspaceId,
        Revision membershipRevision,
        IdentityMembershipAuditAction action,
        bool accountCreated)
        : base(AuditDetailKind.IdentityMembership)
    {
        AccountPrincipalId = accountPrincipalId.Value;
        WorkspaceId = workspaceId?.Value;
        MembershipRevision = membershipRevision.Value;
        Action = (int)action;
        AccountCreated = accountCreated;
    }

    internal string AccountPrincipalId { get; private set; }
    internal string? WorkspaceId { get; private set; }
    internal long MembershipRevision { get; private set; }
    internal int Action { get; private set; }
    internal bool AccountCreated { get; private set; }

    internal override void WriteCanonical(CanonicalHashWriter writer)
    {
        writer.Append(AccountPrincipalId);
        writer.AppendOptional(WorkspaceId);
        writer.Append(MembershipRevision);
        writer.Append(Action);
        writer.Append(AccountCreated ? 1 : 0);
    }
}
