using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Caching;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public sealed record TenantResolution(
    TenantId TenantId,
    TenantLifecycle Lifecycle,
    TenantRevision Revision,
    AddressBindingGeneration? AddressBindingGeneration,
    CacheExpiry CacheExpiry);
