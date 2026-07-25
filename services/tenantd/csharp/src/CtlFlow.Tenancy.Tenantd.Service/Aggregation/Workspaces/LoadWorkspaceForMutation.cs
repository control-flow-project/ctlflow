using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.Workspaces;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures.AggregationFailures;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests.AggregationRequests;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Workspaces;

internal static partial class WorkspaceRoutes
{
    private static async ValueTask<WorkspaceResource>
        LoadWorkspaceForMutation(
            HttpContext context,
            IDbContextFactory<TenantDbContext> database,
            CancellationToken cancellation)
    {
        var workspaceId = await ParseWorkspaceId(
            context.Request.RouteValues["workspaceId"] as string
                ?? string.Empty,
            "workspaceId",
            cancellation);
        var current = await QueryWorkspaceResource(
            database,
            workspaceId,
            cancellation);
        return current is
            ResourceLookupResult<WorkspaceResource>.Found found
            ? found.Resource
            : throw CreateAggregationFailure(
                StatusCodes.Status404NotFound,
                "NotFound",
                "The requested Workspace was not found",
                "workspaces",
                workspaceId.Value);
    }
}
