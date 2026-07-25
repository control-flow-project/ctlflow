using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal static class LifecycleOperationKinds
{
    internal static int ToStorage(LifecycleOperationKind value) =>
        value switch
        {
            (LifecycleOperationKind)0 => 0,
            LifecycleOperationKind.Provision => 1,
            LifecycleOperationKind.Suspend => 2,
            LifecycleOperationKind.Resume => 3,
            LifecycleOperationKind.Delete => 4,
            _ => throw new InvalidOperationException(
                "Lifecycle operation kind is invalid")
        };

    internal static LifecycleOperationKind FromStorage(int value) =>
        value switch
        {
            0 => (LifecycleOperationKind)0,
            1 => LifecycleOperationKind.Provision,
            2 => LifecycleOperationKind.Suspend,
            3 => LifecycleOperationKind.Resume,
            4 => LifecycleOperationKind.Delete,
            _ => throw new InvalidOperationException(
                "Stored lifecycle operation kind is invalid")
        };
}
