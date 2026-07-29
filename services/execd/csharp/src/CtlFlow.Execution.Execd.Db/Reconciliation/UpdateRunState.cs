using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Domain.Time;

namespace CtlFlow.Execution.Execd.Db.Reconciliation;

public static partial class ReconciliationState
{
    public static async Task UpdateRunState(
        ExecutionDatabase database,
        RunId runId,
        Revision expectedRevision,
        RunPhase phase,
        RunReason reason,
        int attemptCount,
        UtcInstant? startedAt,
        UtcInstant? completedAt,
        UtcInstant now,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "update_run_state");
        await using var lease =
            await database.AcquireMutation(cancellation);
        var current = await Db.Runs.Runs.LoadRun(
            database,
            runId,
            cancellation);
        if (current is null)
        {
            return;
        }

        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var entity = Run.Restore(current);
        context.Attach(entity);
        if (!await Domain.Runs.Runs.UpdateRunState(
                entity,
                current,
                expectedRevision,
                phase,
                reason,
                attemptCount,
                startedAt,
                completedAt,
                now,
                cancellation))
        {
            return;
        }

        await context.SaveChangesAsync(cancellation);
    }
}
