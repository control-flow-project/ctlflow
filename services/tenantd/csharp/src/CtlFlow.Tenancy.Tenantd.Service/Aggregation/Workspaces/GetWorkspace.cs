using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.Workspaces;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures.AggregationFailures;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests.AggregationRequests;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses.AggregationResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization.AggregationJson;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Workspaces;

internal static partial class WorkspaceRoutes
{
    internal static async Task GetWorkspace(HttpContext context)
    {
        var cancellation = context.RequestAborted;
        var workspaceId = await ParseWorkspaceId(
            context.Request.RouteValues["workspaceId"] as string
                ?? string.Empty,
            "workspaceId",
            cancellation);
        var result = await QueryWorkspaceResource(
            context.RequestServices.GetRequiredService<
                IDbContextFactory<TenantDbContext>>(),
            workspaceId,
            cancellation);
        if (result is not
            ResourceLookupResult<WorkspaceResource>.Found found)
        {
            throw CreateAggregationFailure(
                StatusCodes.Status404NotFound,
                "NotFound",
                "The requested Workspace was not found",
                "workspaces",
                workspaceId.Value);
        }

        var json = context.RequestServices.GetRequiredService<
            TenancyJsonContext>();
        await WriteJsonDocument(
            context.Response,
            StatusCodes.Status200OK,
            CreateWorkspaceDocument(found.Resource),
            json.WorkspaceDocument,
            cancellation);
    }
}
