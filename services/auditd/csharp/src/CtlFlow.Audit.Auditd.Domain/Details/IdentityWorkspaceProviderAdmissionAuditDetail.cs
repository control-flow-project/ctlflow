using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Providers;
using CtlFlow.Audit.Auditd.Domain.Workspaces;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class IdentityWorkspaceProviderAdmissionAuditDetail : AuditDetail
{
    private IdentityWorkspaceProviderAdmissionAuditDetail()
    {
        WorkspaceId = null!;
        ProviderId = null!;
    }

    public IdentityWorkspaceProviderAdmissionAuditDetail(
        WorkspaceId workspaceId,
        ProviderId providerId,
        IdentityWorkspaceProviderAdmissionAuditAction action)
        : base(AuditDetailKind.IdentityWorkspaceProviderAdmission)
    {
        WorkspaceId = workspaceId.Value;
        ProviderId = providerId.Value;
        Action = (int)action;
    }

    internal string WorkspaceId { get; private set; }
    internal string ProviderId { get; private set; }
    internal int Action { get; private set; }

    internal override void WriteCanonical(CanonicalHashWriter writer)
    {
        writer.Append(WorkspaceId);
        writer.Append(ProviderId);
        writer.Append(Action);
    }
}
