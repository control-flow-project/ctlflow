using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.V1;
using Google.Protobuf.WellKnownTypes;
using Grpc.Core;
using DomainTenantLifecycle = CtlFlow.Tenancy.Tenantd.Domain.Tenants.TenantLifecycle;
using WireTenantLifecycle = CtlFlow.Tenancy.V1.TenantLifecycle;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses;

internal static partial class TenantResponses
{
    internal static ValueTask<ResolveTenantResponse> CreateResolveTenantResponse(
        ResolveTenantResult result,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();

        if (result is ResolveTenantResult.NotFound)
        {
            throw new RpcException(
                new Status(StatusCode.NotFound, "Tenant was not found"));
        }

        if (result is not ResolveTenantResult.Found found)
        {
            throw new UnreachableException();
        }

        var response = new ResolveTenantResponse
        {
            TenantId = found.Resolution.TenantId.Value,
            Lifecycle = MapLifecycle(found.Resolution.Lifecycle),
            TenantRevision = checked((ulong)found.Resolution.Revision.Value),
            CacheExpiresAt = Timestamp.FromDateTimeOffset(
                found.Resolution.CacheExpiry.Value)
        };

        if (found.Resolution.AddressBindingGeneration is { } generation)
        {
            response.Address = new ResolvedTenantAddress
            {
                BindingGeneration = checked((ulong)generation.Value)
            };
        }

        return ValueTask.FromResult(response);
    }

    private static WireTenantLifecycle MapLifecycle(
        DomainTenantLifecycle lifecycle) =>
        lifecycle switch
        {
            DomainTenantLifecycle.Provisioning =>
                WireTenantLifecycle.Provisioning,
            DomainTenantLifecycle.Active =>
                WireTenantLifecycle.Active,
            DomainTenantLifecycle.Suspended =>
                WireTenantLifecycle.Suspended,
            DomainTenantLifecycle.Deleting =>
                WireTenantLifecycle.Deleting,
            DomainTenantLifecycle.Failed =>
                WireTenantLifecycle.Failed,
            DomainTenantLifecycle.Deleted =>
                WireTenantLifecycle.Deleted,
            _ => throw new UnreachableException()
        };
}
