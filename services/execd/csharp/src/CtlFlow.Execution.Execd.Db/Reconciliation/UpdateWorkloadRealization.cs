using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Time;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Db.Reconciliation;

public static partial class ReconciliationState
{
    public static async Task UpdateWorkloadRealization(
        ExecutionDatabase database,
        WorkloadId workloadId,
        Revision desiredRevision,
        RealizationPhase phase,
        RealizationReason reason,
        UtcInstant now,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "update_workload_realization");
        await using var lease =
            await database.AcquireMutation(cancellation);
        var current = await Db.Workloads.Workloads.LoadWorkload(
            database,
            workloadId,
            cancellation);
        if (current is null)
        {
            return;
        }

        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var entity = Workload.Restore(current);
        context.Attach(entity);
        if (!await Domain.Workloads.Workloads
                .UpdateWorkloadRealization(
                    entity,
                    current,
                    desiredRevision,
                    phase,
                    reason,
                    now,
                    cancellation))
        {
            return;
        }

        await context.SaveChangesAsync(cancellation);
    }
}
