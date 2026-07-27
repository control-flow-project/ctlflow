using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Placements;
using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Resources;
using CtlFlow.Audit.Auditd.Domain.Runs;
using CtlFlow.Audit.Auditd.Domain.Tenants;
using CtlFlow.Audit.Auditd.Domain.Workloads;
using CtlFlow.Audit.Auditd.Domain.Workspaces;
using static CtlFlow.Audit.Auditd.Domain.Events.AuditCanonicalization;

namespace CtlFlow.Audit.Auditd.Domain.Details;

public class RunMutationAuditDetail : AuditDetail
{
    private RunMutationAuditDetail()
    {
        RunId = null!;
        WorkloadId = null!;
        PlacementId = null!;
    }

    public RunMutationAuditDetail(
        RunId runId,
        WorkloadId workloadId,
        PlacementId placementId,
        PlacementAuditTarget placementTarget,
        RunAuditAction action,
        Revision runRevision,
        PrincipalId? configuredActorPrincipalId)
        : base(AuditDetailKind.RunMutation)
    {
        RunId = runId.Value;
        WorkloadId = workloadId.Value;
        PlacementId = placementId.Value;
        TargetKind = placementTarget.Kind;
        TargetTenantId = placementTarget.TenantId?.Value;
        TargetWorkspaceId = placementTarget.WorkspaceId?.Value;
        TargetAccountPrincipalId =
            placementTarget.AccountPrincipalId?.Value;
        Action = (int)action;
        RunRevision = runRevision.Value;
        ConfiguredActorPrincipalId = configuredActorPrincipalId?.Value;
    }

    internal string RunId { get; private set; }
    internal string WorkloadId { get; private set; }
    internal string PlacementId { get; private set; }
    internal PlacementTargetKind TargetKind { get; private set; }
    internal string? TargetTenantId { get; private set; }
    internal string? TargetWorkspaceId { get; private set; }
    internal string? TargetAccountPrincipalId { get; private set; }
    internal int Action { get; private set; }
    internal long RunRevision { get; private set; }
    internal string? ConfiguredActorPrincipalId { get; private set; }

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
        writer.Append(RunId);
        writer.Append(WorkloadId);
        writer.Append(PlacementId);
        WriteTarget(writer, PlacementTarget);
        writer.Append(Action);
        writer.Append(RunRevision);
        writer.AppendOptional(ConfiguredActorPrincipalId);
    }
}
