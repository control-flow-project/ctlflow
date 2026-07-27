using CtlFlow.Audit.Auditd.Domain.Apps;
using CtlFlow.Audit.Auditd.Domain.Components;
using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Packages;
using CtlFlow.Audit.Auditd.Domain.Placements;
using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Resources;
using CtlFlow.Audit.Auditd.Domain.Tenants;
using CtlFlow.Audit.Auditd.Domain.Workloads;
using CtlFlow.Audit.Auditd.Domain.Workspaces;
using static CtlFlow.Audit.Auditd.Domain.Events.AuditCanonicalization;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class WorkloadMutationAuditDetail : AuditDetail
{
    private WorkloadMutationAuditDetail()
    {
        WorkloadId = null!;
        PlacementId = null!;
        AppId = null!;
        PackageId = null!;
        ComponentId = null!;
    }

    public WorkloadMutationAuditDetail(
        WorkloadId workloadId,
        PlacementId placementId,
        PlacementAuditTarget placementTarget,
        WorkloadAuditAction action,
        Revision workloadRevision,
        ExecutionAuditState resultingDesiredState,
        AppId appId,
        Revision appRevision,
        PackageId packageId,
        Generation packageGeneration,
        ComponentId componentId)
        : base(AuditDetailKind.WorkloadMutation)
    {
        WorkloadId = workloadId.Value;
        PlacementId = placementId.Value;
        TargetKind = placementTarget.Kind;
        TargetTenantId = placementTarget.TenantId?.Value;
        TargetWorkspaceId = placementTarget.WorkspaceId?.Value;
        TargetAccountPrincipalId =
            placementTarget.AccountPrincipalId?.Value;
        Action = (int)action;
        WorkloadRevision = workloadRevision.Value;
        ResultingDesiredState = (int)resultingDesiredState;
        AppId = appId.Value;
        AppRevision = appRevision.Value;
        PackageId = packageId.Value;
        PackageGeneration = packageGeneration.Value;
        ComponentId = componentId.Value;
    }

    internal string WorkloadId { get; private set; }
    internal string PlacementId { get; private set; }
    internal PlacementTargetKind TargetKind { get; private set; }
    internal string? TargetTenantId { get; private set; }
    internal string? TargetWorkspaceId { get; private set; }
    internal string? TargetAccountPrincipalId { get; private set; }
    internal int Action { get; private set; }
    internal long WorkloadRevision { get; private set; }
    internal int ResultingDesiredState { get; private set; }
    internal string AppId { get; private set; }
    internal long AppRevision { get; private set; }
    internal string PackageId { get; private set; }
    internal long PackageGeneration { get; private set; }
    internal string ComponentId { get; private set; }

    internal PlacementAuditTarget PlacementTarget => new(
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
        writer.Append(WorkloadId);
        writer.Append(PlacementId);
        WriteTarget(writer, PlacementTarget);
        writer.Append(Action);
        writer.Append(WorkloadRevision);
        writer.Append(ResultingDesiredState);
        writer.Append(AppId);
        writer.Append(AppRevision);
        writer.Append(PackageId);
        writer.Append(PackageGeneration);
        writer.Append(ComponentId);
    }
}
