using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public static partial class LifecycleOperations
{
    public static ValueTask AcknowledgeLifecycleStep(
        LifecycleStep step,
        LifecycleStepOutcome outcome,
        LifecycleOwnerRevision ownerRevision,
        BlockedReason? blockedReason,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (step.State != LifecycleStepState.Pending)
        {
            throw new InvalidOperationException(
                "Lifecycle step is not pending");
        }

        if (outcome == LifecycleStepOutcome.Blocked
            && blockedReason is null)
        {
            throw new ArgumentException(
                "A blocked acknowledgement requires a reason",
                nameof(blockedReason));
        }

        if (outcome == LifecycleStepOutcome.Complete
            && blockedReason is not null)
        {
            throw new ArgumentException(
                "A complete acknowledgement cannot contain a reason",
                nameof(blockedReason));
        }

        step.State = outcome == LifecycleStepOutcome.Complete
            ? LifecycleStepState.Complete
            : LifecycleStepState.Blocked;
        step.OwnerRevision = ownerRevision;
        step.BlockedReason = blockedReason;
        step.Revision = LifecycleStepRevision.FromStorage(
            checked(step.Revision.Value + 1));
        step.UpdatedAt = now;
        return ValueTask.CompletedTask;
    }
}
