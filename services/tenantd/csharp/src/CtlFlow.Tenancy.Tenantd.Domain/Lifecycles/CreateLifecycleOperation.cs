using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public static partial class LifecycleOperations
{
    public static ValueTask<LifecycleOperation> CreateLifecycleOperation(
        LifecycleOperationId operationId,
        LifecycleTarget target,
        LifecycleOperationKind kind,
        long provisioningGeneration,
        RequestActor actor,
        IdempotencyKey idempotencyKey,
        RequestDigest requestDigest,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (provisioningGeneration <= 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(provisioningGeneration));
        }

        return ValueTask.FromResult(new LifecycleOperation(
            operationId,
            target,
            kind,
            provisioningGeneration,
            actor,
            idempotencyKey,
            requestDigest,
            now));
    }
}
