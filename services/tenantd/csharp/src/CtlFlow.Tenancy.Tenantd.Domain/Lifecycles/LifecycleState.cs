namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public enum LifecycleState
{
    Provisioning = 1,
    Active = 2,
    Suspending = 3,
    Suspended = 4,
    Resuming = 5,
    Deleting = 6,
    Failed = 7,
    Deleted = 8
}
