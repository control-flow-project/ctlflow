namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public static partial class LifecycleTransitions
{
    public static bool IsDisplayMetadataUpdateAdmitted(
        LifecycleState state) =>
        state switch
        {
            LifecycleState.Provisioning => true,
            LifecycleState.Active => true,
            LifecycleState.Suspending => true,
            LifecycleState.Suspended => true,
            LifecycleState.Resuming => true,
            LifecycleState.Failed => true,
            LifecycleState.Deleting => false,
            LifecycleState.Deleted => false,
            _ => throw new InvalidOperationException(
                "Lifecycle state is invalid")
        };
}
