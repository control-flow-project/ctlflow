namespace CtlFlow.Execution.Execd.Domain.Runs;

public static partial class Runs
{
    public static ValueTask<Run> RestoreRun(
        RunRecord record,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(Run.Restore(record));
    }
}
