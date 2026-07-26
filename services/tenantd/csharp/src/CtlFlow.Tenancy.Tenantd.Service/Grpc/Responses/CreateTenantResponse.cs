using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.V1;
using Google.Protobuf.WellKnownTypes;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses;

internal static partial class TenancyResponses
{
    internal static CtlFlow.Tenancy.V1.Tenant CreateTenantResponse(
        TenantDetails tenant) =>
        new()
        {
            TenantId = tenant.TenantId.Value,
            Address = tenant.Address.Value,
            DisplayName = tenant.DisplayName.Value,
            State = MapResourceState(tenant.State),
            Revision = checked((ulong)tenant.Revision.Value),
            CreatedAt = Timestamp.FromDateTimeOffset(tenant.CreatedAt.Value),
            UpdatedAt = Timestamp.FromDateTimeOffset(tenant.UpdatedAt.Value)
        };
}
