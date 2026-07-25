namespace CtlFlow.Tenancy.Tenantd.Domain.Collections;

public enum ResourceMutationFailure
{
    IdempotencyConflict = 1,
    AddressAlreadyBound = 2,
    ResourceVersionMismatch = 3,
    LifecycleNotAdmitted = 4,
    ParentTenantNotActive = 5,
    TenantHasWorkspaces = 6,
    ImmutableSpecMismatch = 7,
    OperationNotRetryable = 8
}
