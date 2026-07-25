namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public static class LifecycleStates
{
    public static int ToStorage(LifecycleState value) =>
        value switch
        {
            (LifecycleState)0 => 0,
            LifecycleState.Provisioning => 1,
            LifecycleState.Active => 2,
            LifecycleState.Suspending => 3,
            LifecycleState.Suspended => 4,
            LifecycleState.Resuming => 5,
            LifecycleState.Deleting => 6,
            LifecycleState.Failed => 7,
            LifecycleState.Deleted => 8,
            _ => throw new InvalidOperationException(
                "Lifecycle state is invalid")
        };

    public static LifecycleState FromStorage(int value) =>
        value switch
        {
            0 => default,
            1 => LifecycleState.Provisioning,
            2 => LifecycleState.Active,
            3 => LifecycleState.Suspending,
            4 => LifecycleState.Suspended,
            5 => LifecycleState.Resuming,
            6 => LifecycleState.Deleting,
            7 => LifecycleState.Failed,
            8 => LifecycleState.Deleted,
            _ => throw new InvalidOperationException(
                "Stored lifecycle state is invalid")
        };
}
