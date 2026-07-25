using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.Workspaces;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditCorrelations;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures.AggregationFailures;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests.AggregationRequests;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses.AggregationResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization.AggregationJson;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Workspaces;

internal static partial class WorkspaceRoutes
{
    internal static async Task UpdateWorkspace(HttpContext context)
    {
        var cancellation = context.RequestAborted;
        var workspaceId = await ParseWorkspaceId(
            context.Request.RouteValues["workspaceId"] as string
                ?? string.Empty,
            "workspaceId",
            cancellation);
        var database = context.RequestServices.GetRequiredService<
            IDbContextFactory<TenantDbContext>>();
        var current = await QueryWorkspaceResource(
            database,
            workspaceId,
            cancellation);
        if (current is not
            ResourceLookupResult<WorkspaceResource>.Found found)
        {
            throw CreateAggregationFailure(
                StatusCodes.Status404NotFound,
                "NotFound",
                "The requested Workspace was not found",
                "workspaces",
                workspaceId.Value);
        }

        var identity = context.Features.Get<AggregationRequestIdentity>()
            ?? throw new InvalidOperationException(
                "Aggregation identity is unavailable");
        var json = context.RequestServices.GetRequiredService<
            TenancyJsonContext>();
        var document = await ReadJsonDocument(
            context.Request,
            json.WorkspaceDocument,
            cancellation);
        var idempotencyKey = await ParseIdempotencyKey(
            context.Request,
            cancellation);
        var command = await ParseUpdateWorkspace(
            document,
            found.Resource,
            identity.Actor,
            idempotencyKey,
            cancellation);
        var auditCorrelation = await CreateAuditCorrelation(
            Activity.Current,
            cancellation);
        var result = await UpdateWorkspaceResource(
            database,
            command,
            auditCorrelation,
            UtcInstant.FromClock(DateTimeOffset.UtcNow),
            cancellation);
        await WriteWorkspaceMutationResult(
            context.Response,
            result,
            StatusCodes.Status200OK,
            json,
            cancellation);
    }
}
