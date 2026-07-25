using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal static class LifecycleStepKeys
{
    internal static int ToStorage(LifecycleStepKey value) =>
        value switch
        {
            (LifecycleStepKey)0 => 0,
            LifecycleStepKey.Identity => 1,
            LifecycleStepKey.Configuration => 2,
            LifecycleStepKey.Execution => 3,
            LifecycleStepKey.Packages => 4,
            _ => throw new InvalidOperationException(
                "Lifecycle step key is invalid")
        };

    internal static LifecycleStepKey FromStorage(int value) =>
        value switch
        {
            0 => (LifecycleStepKey)0,
            1 => LifecycleStepKey.Identity,
            2 => LifecycleStepKey.Configuration,
            3 => LifecycleStepKey.Execution,
            4 => LifecycleStepKey.Packages,
            _ => throw new InvalidOperationException(
                "Stored lifecycle step key is invalid")
        };
}
