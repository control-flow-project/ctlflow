using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public sealed record TenantDetails(
    TenantId TenantId,
    ResourceAddress Address,
    DisplayName DisplayName,
    ResourceState State,
    Revision Revision,
    UtcInstant CreatedAt,
    UtcInstant UpdatedAt);
