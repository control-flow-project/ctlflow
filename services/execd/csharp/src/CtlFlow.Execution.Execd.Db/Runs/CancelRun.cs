using CtlFlow.Execution.Execd.Domain.Auditing;
using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Runs;
namespace CtlFlow.Execution.Execd.Db.Runs;

public static partial class Runs
{
    public static async Task<MutationResult<RunRecord>> CancelRun(
        ExecutionDatabase database,
        RunId runId,
        AuditContext audit,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "cancel_run");
        await using var lease =
            await database.AcquireMutation(cancellation);
        var current = await LoadRun(database, runId, cancellation)
            ?? throw new ExecutionException(
                ExecutionError.NotFound,
                "Run was not found");
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var row = await Domain.Runs.Runs.RestoreRun(
            current,
            cancellation);
        context.Attach(row);
        var decision = await Domain.Runs.Runs.DecideRunCancellation(
            row,
            current,
            audit,
            cancellation);
        if (decision is RunCancellationDecision.Current retained)
        {
            return new MutationResult<RunRecord>(
                retained.Run,
                null);
        }

        var changed = decision as RunCancellationDecision.Changed
            ?? throw new InvalidOperationException(
                "Run cancellation decision is invalid");
        await context.SaveChangesAsync(cancellation);
        return new MutationResult<RunRecord>(
            changed.Run,
            changed.Audit);
    }
}
