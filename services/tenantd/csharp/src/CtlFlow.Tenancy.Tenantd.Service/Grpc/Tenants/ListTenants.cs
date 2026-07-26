using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses.TenancyResponses;
using TenantDatabase = CtlFlow.Tenancy.Tenantd.Db.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<ListTenantsResponse> ListTenants(
        ListTenantsRequest request,
        ServerCallContext context)
    {
        await AuthenticateAdministration(context);
        var after = request.HasAfterTenantId
            ? await TenantId.Parse(
                request.AfterTenantId,
                context.CancellationToken)
            : null;
        var page = await TenantDatabase.ListTenants(
            _tenantDatabase,
            await PageSize.Parse(
                request.PageSize,
                context.CancellationToken),
            after,
            context.CancellationToken);
        var response = new ListTenantsResponse();
        response.Tenants.Add(page.Tenants.Select(CreateTenantResponse));
        if (page.NextAfterTenantId is not null)
        {
            response.NextAfterTenantId = page.NextAfterTenantId.Value;
        }

        return response;
    }
}
