using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Authorization.TenantAuthorization;
using CtlFlow.Tenancy.Tenantd.Service.Authorization;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses.TenancyResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.TenantGrpcErrors;
using TenantDatabase = CtlFlow.Tenancy.Tenantd.Db.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<CtlFlow.Tenancy.V1.Tenant> GetTenant(
        GetTenantRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateTenantLookup(context);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        await AuthorizeTenantCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            TenantCapability.ReadTenant,
            tenantId,
            null,
            context.CancellationToken);
        var result = await TenantDatabase.GetTenant(
            _tenantDatabase,
            tenantId,
            context.CancellationToken);
        return result switch
        {
            TenantLookupResult.Found found =>
                CreateTenantResponse(found.Tenant),
            TenantLookupResult.NotFound =>
                throw CreateExpectedRpcException(StatusCode.NotFound),
            _ => throw new InvalidOperationException(
                "Tenant lookup result is invalid")
        };
    }
}
