using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public static partial class LifecycleOperations
{
    public static ValueTask RetryLifecycleStep(
        LifecycleStep step,
        LifecycleDeliverySequence deliverySequence,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (step.State != LifecycleStepState.Blocked)
        {
            throw new InvalidOperationException(
                "Only a blocked lifecycle step can be retried");
        }

        step.State = LifecycleStepState.Pending;
        step.OwnerRevision = null;
        step.BlockedReason = null;
        step.Revision = LifecycleStepRevision.FromStorage(
            checked(step.Revision.Value + 1));
        step.DeliverySequenceStorage = deliverySequence.Value;
        step.UpdatedAt = now;
        return ValueTask.CompletedTask;
    }
}
