using CtlFlow.Execution.Execd.Domain.Auditing;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Domain.Runs;

public static partial class Runs
{
    public static async ValueTask<CreatedRun> CreateRun(
        RunId runId,
        WorkloadRecord workload,
        PlacementTarget target,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var finite = workload.Behavior as WorkloadBehavior.Finite
            ?? throw new InvalidOperationException(
                "Run Workload is not finite");
        var record = new RunRecord(
            runId,
            workload.Id,
            workload.Revision,
            workload.PlacementId,
            target,
            finite.ActorPrincipalId,
            new RunExecutionSnapshot(
                workload.AdmittedPackage,
                workload.Resources,
                workload.ConfigTargets,
                workload.Dependencies,
                workload.Storage,
                finite.RunDurationSeconds,
                finite.MaxAttempts),
            RunPhase.Pending,
            RunReason.None,
            0,
            Revision.Initial(),
            audit.OccurredAt,
            null,
            audit.OccurredAt,
            null);
        var intent = await ExecutionAudits.CreateRunAudit(
            record,
            RunAuditAction.Created,
            audit,
            cancellation);
        return new CreatedRun(
            Run.Restore(record),
            record,
            intent);
    }
}
