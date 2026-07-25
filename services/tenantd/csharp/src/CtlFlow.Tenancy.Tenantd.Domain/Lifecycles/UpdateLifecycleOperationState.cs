using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public static partial class LifecycleOperations
{
    public static ValueTask UpdateLifecycleOperationState(
        LifecycleOperation operation,
        bool blocked,
        bool complete,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        operation.State = blocked
            ? LifecycleOperationState.Blocked
            : complete
                ? LifecycleOperationState.Complete
                : LifecycleOperationState.Pending;
        operation.UpdatedAt = now;
        return ValueTask.CompletedTask;
    }
}
