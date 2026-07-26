using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses.TenancyResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.TenantGrpcErrors;
using TenantDatabase = CtlFlow.Tenancy.Tenantd.Db.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<ResolveTenantResponse> ResolveTenant(
        ResolveTenantRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateTenantResolution(context);
        var result = await TenantDatabase.ResolveTenant(
            _tenantDatabase,
            await ResourceAddress.Parse(
                request.Address,
                context.CancellationToken),
            context.CancellationToken);
        if (result is TenantResolutionResult.Found resolved
            && identity.Invocation?.TenantId is { } fencedTenant
            && resolved.TenantId != fencedTenant)
        {
            result = new TenantResolutionResult.NotFound();
        }

        return result switch
        {
            TenantResolutionResult.Found found => new ResolveTenantResponse
            {
                TenantId = found.TenantId.Value,
                State = MapResourceState(found.State),
                Revision = checked((ulong)found.Revision.Value)
            },
            TenantResolutionResult.NotFound =>
                throw CreateExpectedRpcException(StatusCode.NotFound),
            _ => throw new InvalidOperationException(
                "Tenant resolution result is invalid")
        };
    }
}
