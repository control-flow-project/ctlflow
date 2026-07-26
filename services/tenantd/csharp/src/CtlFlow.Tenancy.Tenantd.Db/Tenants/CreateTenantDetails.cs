using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

internal static partial class TenantMappings
{
    internal static TenantDetails CreateTenantDetails(
        string tenantId,
        string address,
        DisplayName displayName,
        ResourceState state,
        Revision revision,
        UtcInstant createdAt,
        UtcInstant updatedAt) =>
        new(
            TenantId.FromStorage(tenantId),
            ResourceAddress.FromStorage(address),
            displayName,
            state,
            revision,
            createdAt,
            updatedAt);
}
