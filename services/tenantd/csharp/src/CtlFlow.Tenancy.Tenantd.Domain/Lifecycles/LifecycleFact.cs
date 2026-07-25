using CtlFlow.Tenancy.Tenantd.Domain.Caching;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public sealed record LifecycleFact(
    LifecycleTarget Target,
    LifecycleState Lifecycle,
    LifecycleState? ParentTenantLifecycle,
    long ResourceRevision,
    long ProvisioningGeneration,
    LifecycleOperationId? CurrentOperationId,
    CacheExpiry CacheExpiry);
