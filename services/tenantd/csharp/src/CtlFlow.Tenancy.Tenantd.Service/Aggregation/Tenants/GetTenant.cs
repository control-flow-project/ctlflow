using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.Tenants;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures.AggregationFailures;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests.AggregationRequests;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses.AggregationResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization.AggregationJson;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Tenants;

internal static partial class TenantRoutes
{
    internal static async Task GetTenant(HttpContext context)
    {
        var cancellation = context.RequestAborted;
        var tenantId = await ParseTenantId(
            context.Request.RouteValues["tenantId"] as string
                ?? string.Empty,
            "tenantId",
            cancellation);
        var result = await QueryTenantResource(
            context.RequestServices.GetRequiredService<
                IDbContextFactory<TenantDbContext>>(),
            tenantId,
            cancellation);
        if (result is not ResourceLookupResult<TenantResource>.Found found)
        {
            throw CreateAggregationFailure(
                StatusCodes.Status404NotFound,
                "NotFound",
                "The requested Tenant was not found",
                "tenants",
                tenantId.Value);
        }

        var json = context.RequestServices.GetRequiredService<
            TenancyJsonContext>();
        await WriteJsonDocument(
            context.Response,
            StatusCodes.Status200OK,
            CreateTenantDocument(found.Resource),
            json.TenantDocument,
            cancellation);
    }
}
