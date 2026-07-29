using CtlFlow.Execution.Execd.Domain.Time;

namespace CtlFlow.Execution.Execd.Domain.Resources;

public sealed record RealizationStatus(
    Revision StatusRevision,
    long ObservedRevision,
    RealizationPhase Phase,
    RealizationReason Reason,
    UtcInstant UpdatedAt)
{
    public static RealizationStatus Pending(UtcInstant now) =>
        new(Revision.Initial(), 0, RealizationPhase.Pending, RealizationReason.None, now);
}
