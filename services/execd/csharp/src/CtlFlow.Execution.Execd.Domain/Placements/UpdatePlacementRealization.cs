using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Time;

namespace CtlFlow.Execution.Execd.Domain.Placements;

public static partial class Placements
{
    public static ValueTask<bool> UpdatePlacementRealization(
        Placement entity,
        PlacementRecord current,
        Revision desiredRevision,
        RealizationPhase phase,
        RealizationReason reason,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (current.Revision != desiredRevision)
        {
            return ValueTask.FromResult(false);
        }

        var observed = desiredRevision.Value;
        if (current.Realization.Phase == phase
            && current.Realization.Reason == reason
            && current.Realization.ObservedRevision == observed)
        {
            return ValueTask.FromResult(false);
        }

        entity.Apply(current with
        {
            Realization = new RealizationStatus(
                current.Realization.StatusRevision.Next(),
                observed,
                phase,
                reason,
                now)
        });
        return ValueTask.FromResult(true);
    }
}
