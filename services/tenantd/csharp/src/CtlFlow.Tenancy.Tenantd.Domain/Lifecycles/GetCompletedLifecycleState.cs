namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public static partial class LifecycleTransitions
{
    public static LifecycleState GetCompletedLifecycleState(
        LifecycleOperationKind operation) =>
        operation switch
        {
            LifecycleOperationKind.Provision => LifecycleState.Active,
            LifecycleOperationKind.Suspend => LifecycleState.Suspended,
            LifecycleOperationKind.Resume => LifecycleState.Active,
            LifecycleOperationKind.Delete => LifecycleState.Deleted,
            _ => throw new InvalidOperationException(
                "Lifecycle operation is invalid")
        };
}
