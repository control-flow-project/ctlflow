using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Time;

namespace CtlFlow.Execution.Execd.Domain.Runs;

public static partial class Runs
{
    public static ValueTask<bool> UpdateRunState(
        Run entity,
        RunRecord current,
        Revision expectedRevision,
        RunPhase phase,
        RunReason reason,
        int attemptCount,
        UtcInstant? startedAt,
        UtcInstant? completedAt,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (current.Revision != expectedRevision || current.IsTerminal)
        {
            return ValueTask.FromResult(false);
        }

        if (attemptCount < 0
            || attemptCount > current.Execution.MaxAttempts)
        {
            throw new InvalidOperationException(
                "Run attempt count is invalid");
        }

        var normalizedStartedAt = NormalizeAfter(
            current.StartedAt ?? startedAt,
            current.CreatedAt);
        var normalizedCompletedAt = NormalizeAfter(
            completedAt,
            normalizedStartedAt ?? current.CreatedAt);
        if (current.Phase == phase
            && current.Reason == reason
            && current.AttemptCount == attemptCount
            && current.StartedAt == normalizedStartedAt
            && current.CompletedAt == normalizedCompletedAt)
        {
            return ValueTask.FromResult(false);
        }

        entity.Apply(current with
        {
            Phase = phase,
            Reason = reason,
            AttemptCount = attemptCount,
            StartedAt = normalizedStartedAt,
            CompletedAt = normalizedCompletedAt,
            UpdatedAt = now
        });
        return ValueTask.FromResult(true);
    }

    private static UtcInstant? NormalizeAfter(
        UtcInstant? value,
        UtcInstant minimum) =>
        value is not null
            && value.UnixMilliseconds < minimum.UnixMilliseconds
                ? minimum
                : value;
}
