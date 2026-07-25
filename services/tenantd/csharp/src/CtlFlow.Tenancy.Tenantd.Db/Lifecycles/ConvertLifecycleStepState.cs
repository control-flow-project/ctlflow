using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal static class LifecycleStepStates
{
    internal static int ToStorage(LifecycleStepState value) =>
        value switch
        {
            (LifecycleStepState)0 => 0,
            LifecycleStepState.Pending => 1,
            LifecycleStepState.Blocked => 2,
            LifecycleStepState.Complete => 3,
            _ => throw new InvalidOperationException(
                "Lifecycle step state is invalid")
        };

    internal static LifecycleStepState FromStorage(int value) =>
        value switch
        {
            0 => (LifecycleStepState)0,
            1 => LifecycleStepState.Pending,
            2 => LifecycleStepState.Blocked,
            3 => LifecycleStepState.Complete,
            _ => throw new InvalidOperationException(
                "Stored lifecycle step state is invalid")
        };
}
