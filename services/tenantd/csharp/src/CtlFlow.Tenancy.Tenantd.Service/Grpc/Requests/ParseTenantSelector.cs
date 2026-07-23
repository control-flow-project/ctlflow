using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.V1;
using Grpc.Core;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Requests;

internal static partial class TenantRequests
{
    internal static async ValueTask<TenantSelector> ParseTenantSelector(
        ResolveTenantRequest request,
        CancellationToken cancellation)
    {
        try
        {
            if (request.HasTenantId == (request.ExternalAddress is not null))
            {
                throw new ArgumentException(
                    "Exactly one Tenant selector is required");
            }

            if (request.HasTenantId)
            {
                return new TenantSelector.ById(
                    await TenantId.Parse(
                        request.TenantId,
                        cancellation));
            }

            var externalAddress = request.ExternalAddress
                ?? throw new ArgumentException(
                    "External Tenant address is required");
            return new TenantSelector.ByExternalAddress(
                await ExternalAuthority.Parse(
                    externalAddress.Authority,
                    cancellation),
                await TenantPathPrefix.Parse(
                    externalAddress.PathPrefix,
                    cancellation));
        }
        catch (ArgumentException)
        {
            throw new RpcException(
                new Status(
                    StatusCode.InvalidArgument,
                    "Tenant selector is invalid"));
        }
    }
}
