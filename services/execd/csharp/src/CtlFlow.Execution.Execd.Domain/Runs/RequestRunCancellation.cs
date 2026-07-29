using CtlFlow.Execution.Execd.Domain.Time;

namespace CtlFlow.Execution.Execd.Domain.Runs;

public static partial class Runs
{
    public static ValueTask RequestRunCancellation(
        Run run,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        run.RequestCancellation(now);
        return ValueTask.CompletedTask;
    }
}
