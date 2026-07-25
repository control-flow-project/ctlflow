using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public static partial class LifecycleOperations
{
    public static ValueTask<LifecycleStep> CreateLifecycleStep(
        LifecycleOperationId operationId,
        LifecycleStepKey key,
        LifecycleDeliverySequence deliverySequence,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new LifecycleStep(
            operationId,
            key,
            deliverySequence,
            now));
    }
}
