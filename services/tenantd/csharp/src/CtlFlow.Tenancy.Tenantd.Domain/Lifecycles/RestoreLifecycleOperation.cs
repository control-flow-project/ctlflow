using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public static partial class LifecycleOperations
{
    public static ValueTask<LifecycleOperation> RestoreLifecycleOperation(
        LifecycleOperationId operationId,
        LifecycleTarget target,
        LifecycleOperationKind kind,
        LifecycleState desiredLifecycle,
        long provisioningGeneration,
        LifecycleOperationState state,
        RequestActor actor,
        IdempotencyKey idempotencyKey,
        RequestDigest requestDigest,
        UtcInstant createdAt,
        UtcInstant updatedAt,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (provisioningGeneration <= 0)
        {
            throw new InvalidOperationException(
                "Stored provisioning generation must be positive");
        }

        return ValueTask.FromResult(new LifecycleOperation(
            operationId,
            target,
            kind,
            desiredLifecycle,
            provisioningGeneration,
            state,
            actor,
            idempotencyKey,
            requestDigest,
            createdAt,
            updatedAt));
    }
}
