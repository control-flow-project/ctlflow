using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Domain.Auditing;

public static class ExecutionAudits
{
    public static ValueTask<AuditIntent> CreatePlacementAudit(
        PlacementRecord placement,
        AuditContext context,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult<AuditIntent>(
            new AuditIntent.PlacementMutation(
                AuditEventId.Create(
                    "placement",
                    placement.Id.Value,
                    placement.Revision.Value),
                context.Attribution,
                context.Correlation,
                context.OccurredAt,
                placement.Id,
                placement.Target,
                placement.Revision.Value == 1
                    ? PlacementAuditAction.Declared
                    : PlacementAuditAction.Updated,
                placement.Revision,
                placement.DesiredState));
    }

    public static ValueTask<AuditIntent> CreateWorkloadAudit(
        WorkloadRecord workload,
        PlacementTarget target,
        AuditContext context,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult<AuditIntent>(
            new AuditIntent.WorkloadMutation(
                AuditEventId.Create(
                    "workload",
                    workload.Id.Value,
                    workload.Revision.Value),
                context.Attribution,
                context.Correlation,
                context.OccurredAt,
                workload.Id,
                workload.PlacementId,
                target,
                workload.Revision.Value == 1
                    ? WorkloadAuditAction.Declared
                    : WorkloadAuditAction.Updated,
                workload.Revision,
                workload.DesiredState,
                workload.AdmittedPackage.AppId,
                workload.AdmittedPackage.AppRevision,
                workload.AdmittedPackage.PackageId,
                workload.AdmittedPackage.PackageGeneration,
                workload.AdmittedPackage.ComponentId));
    }

    public static ValueTask<AuditIntent> CreateRunAudit(
        RunRecord run,
        RunAuditAction action,
        AuditContext context,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult<AuditIntent>(
            new AuditIntent.RunMutation(
                AuditEventId.Create(
                    "run",
                    run.Id.Value,
                    run.Revision.Value),
                context.Attribution,
                context.Correlation,
                context.OccurredAt,
                run.Id,
                run.WorkloadId,
                run.PlacementId,
                run.Target,
                action,
                run.Revision,
                run.ActorPrincipalId));
    }
}
