using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public static partial class LifecycleOperations
{
    public static ValueTask<LifecycleStep> RestoreLifecycleStep(
        LifecycleOperationId operationId,
        LifecycleStepKey key,
        LifecycleStepState state,
        LifecycleStepRevision revision,
        LifecycleDeliverySequence deliverySequence,
        LifecycleOwnerRevision? ownerRevision,
        BlockedReason? blockedReason,
        UtcInstant updatedAt,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new LifecycleStep(
            operationId,
            key,
            state,
            revision,
            deliverySequence,
            ownerRevision,
            blockedReason,
            updatedAt));
    }
}
