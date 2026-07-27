using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Placements;
using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Resources;
using CtlFlow.Audit.Auditd.Domain.Tenants;
using CtlFlow.Audit.Auditd.Domain.Workspaces;
using static CtlFlow.Audit.Auditd.Domain.Events.AuditCanonicalization;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class PlacementMutationAuditDetail : AuditDetail
{
    private PlacementMutationAuditDetail()
    {
        PlacementId = null!;
    }

    public PlacementMutationAuditDetail(
        PlacementId placementId,
        PlacementAuditTarget target,
        PlacementAuditAction action,
        Revision placementRevision,
        ExecutionAuditState resultingDesiredState)
        : base(AuditDetailKind.PlacementMutation)
    {
        PlacementId = placementId.Value;
        TargetKind = target.Kind;
        TargetTenantId = target.TenantId?.Value;
        TargetWorkspaceId = target.WorkspaceId?.Value;
        TargetAccountPrincipalId = target.AccountPrincipalId?.Value;
        Action = (int)action;
        PlacementRevision = placementRevision.Value;
        ResultingDesiredState = (int)resultingDesiredState;
    }

    internal string PlacementId { get; private set; }
    internal PlacementTargetKind TargetKind { get; private set; }
    internal string? TargetTenantId { get; private set; }
    internal string? TargetWorkspaceId { get; private set; }
    internal string? TargetAccountPrincipalId { get; private set; }
    internal int Action { get; private set; }
    internal long PlacementRevision { get; private set; }
    internal int ResultingDesiredState { get; private set; }

    internal PlacementAuditTarget Target => new(
        TargetKind,
        TargetTenantId is null
            ? null
            : TenantId.FromStorage(TargetTenantId),
        TargetWorkspaceId is null
            ? null
            : WorkspaceId.FromStorage(TargetWorkspaceId),
        TargetAccountPrincipalId is null
            ? null
            : AccountId.FromStorage(TargetAccountPrincipalId));

    internal override void WriteCanonical(CanonicalHashWriter writer)
    {
        writer.Append(PlacementId);
        WriteTarget(writer, Target);
        writer.Append(Action);
        writer.Append(PlacementRevision);
        writer.Append(ResultingDesiredState);
    }
}
