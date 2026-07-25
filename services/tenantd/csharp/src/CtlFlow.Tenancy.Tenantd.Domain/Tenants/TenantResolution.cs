using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Caching;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public sealed record TenantResolution(
    TenantId TenantId,
    LifecycleState Lifecycle,
    TenantRevision Revision,
    AddressBindingGeneration? AddressBindingGeneration,
    CacheExpiry CacheExpiry);
