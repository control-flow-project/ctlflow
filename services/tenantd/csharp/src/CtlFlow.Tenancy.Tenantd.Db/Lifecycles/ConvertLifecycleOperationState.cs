using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal static class LifecycleOperationStates
{
    internal static int ToStorage(LifecycleOperationState value) =>
        value switch
        {
            (LifecycleOperationState)0 => 0,
            LifecycleOperationState.Pending => 1,
            LifecycleOperationState.Blocked => 2,
            LifecycleOperationState.Complete => 3,
            _ => throw new InvalidOperationException(
                "Lifecycle operation state is invalid")
        };

    internal static LifecycleOperationState FromStorage(int value) =>
        value switch
        {
            0 => (LifecycleOperationState)0,
            1 => LifecycleOperationState.Pending,
            2 => LifecycleOperationState.Blocked,
            3 => LifecycleOperationState.Complete,
            _ => throw new InvalidOperationException(
                "Stored lifecycle operation state is invalid")
        };
}
