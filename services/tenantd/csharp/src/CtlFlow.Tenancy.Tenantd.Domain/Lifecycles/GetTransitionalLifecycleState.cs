namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public static partial class LifecycleTransitions
{
    public static LifecycleState GetTransitionalLifecycleState(
        LifecycleOperationKind operation) =>
        operation switch
        {
            LifecycleOperationKind.Provision => LifecycleState.Provisioning,
            LifecycleOperationKind.Suspend => LifecycleState.Suspending,
            LifecycleOperationKind.Resume => LifecycleState.Resuming,
            LifecycleOperationKind.Delete => LifecycleState.Deleting,
            _ => throw new InvalidOperationException(
                "Lifecycle operation is invalid")
        };
}
