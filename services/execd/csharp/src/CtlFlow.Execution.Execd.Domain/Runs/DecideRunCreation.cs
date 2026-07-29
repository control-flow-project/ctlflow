using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;

namespace CtlFlow.Execution.Execd.Domain.Runs;

public static partial class Runs
{
    public static ValueTask<RunCreationDecision> DecideRunCreation(
        RunRecord? existing,
        WorkloadId workloadId,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (existing is null)
        {
            return ValueTask.FromResult<RunCreationDecision>(
                new RunCreationDecision.Create());
        }

        if (existing.WorkloadId != workloadId)
        {
            throw new ExecutionException(
                ExecutionError.AlreadyExists,
                "Run ID is already retained");
        }

        return ValueTask.FromResult<RunCreationDecision>(
            new RunCreationDecision.Current(existing));
    }
}
