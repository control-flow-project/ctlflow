using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.Workspaces;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures.AggregationFailures;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests.AggregationRequests;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses.AggregationResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization.AggregationJson;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Workspaces;

internal static partial class WorkspaceRoutes
{
    private static readonly TimeSpan WorkspaceWatchPollInterval =
        TimeSpan.FromMilliseconds(50);

    internal static async Task ListOrWatchWorkspaces(HttpContext context)
    {
        var tenantId = await ParseWorkspaceTenantSelector(
            context.Request,
            context.RequestAborted);
        var request = await ParseCollectionRequest(
            context.Request,
            context.RequestAborted);
        if (request is AggregationCollectionRequest.Watch watch)
        {
            await WatchWorkspaces(context, tenantId, watch.Cursor);
            return;
        }

        var list = (AggregationCollectionRequest.List)request;
        var identity = context.Features.Get<AggregationRequestIdentity>()
            ?? throw new InvalidOperationException(
                "Aggregation identity is unavailable");
        var settings = context.RequestServices.GetRequiredService<
            TenantOperationSettings>();
        var visibility = RequestDigest.Calculate(
            $"operator:workspaces:{tenantId.Value}");
        var result = await ListWorkspaceResources(
            context.RequestServices.GetRequiredService<
                IDbContextFactory<TenantDbContext>>(),
            tenantId,
            list.PageSize,
            list.PageToken,
            identity.Actor,
            visibility,
            settings.PageCursorLifetime,
            UtcInstant.FromClock(DateTimeOffset.UtcNow),
            context.RequestAborted);
        if (result is
            ResourceListResult<WorkspaceResource>.ExpiredPageToken)
        {
            throw CreateAggregationFailure(
                StatusCodes.Status410Gone,
                "Expired",
                "The Workspace continuation has expired",
                "workspaces");
        }

        var page =
            ((ResourceListResult<WorkspaceResource>.Page)result).Value;
        var json = context.RequestServices.GetRequiredService<
            TenancyJsonContext>();
        await WriteJsonDocument(
            context.Response,
            StatusCodes.Status200OK,
            CreateWorkspaceListDocument(page),
            json.WorkspaceListDocument,
            context.RequestAborted);
    }

    private static async Task WatchWorkspaces(
        HttpContext context,
        Domain.Tenants.TenantId tenantId,
        ResourceEventCursor cursor)
    {
        var settings = context.RequestServices.GetRequiredService<
            TenantOperationSettings>();
        var database = context.RequestServices.GetRequiredService<
            IDbContextFactory<TenantDbContext>>();
        var json = context.RequestServices.GetRequiredService<
            TenancyJsonContext>();
        var stopAt = DateTimeOffset.UtcNow
            + settings.WatchLifetime.Value;
        context.Response.StatusCode = StatusCodes.Status200OK;
        context.Response.ContentType = "application/json;stream=watch";

        while (DateTimeOffset.UtcNow < stopAt)
        {
            var read = await ReadWorkspaceResourceEvents(
                database,
                tenantId,
                cursor,
                context.RequestAborted);
            if (read is
                ResourceWatchReadResult<WorkspaceResource>.InvalidCursor)
            {
                throw CreateAggregationFailure(
                    StatusCodes.Status400BadRequest,
                    "Invalid",
                    "The Workspace watch cursor is invalid",
                    "workspaces");
            }

            if (read is
                ResourceWatchReadResult<WorkspaceResource>.ExpiredCursor)
            {
                throw CreateAggregationFailure(
                    StatusCodes.Status410Gone,
                    "Expired",
                    "The Workspace watch cursor has expired",
                    "workspaces");
            }

            var batch =
                (ResourceWatchReadResult<WorkspaceResource>.Batch)read;
            foreach (var item in batch.Events)
            {
                await WriteWorkspaceWatchEvent(
                    context.Response,
                    item,
                    json,
                    context.RequestAborted);
                cursor = ResourceEventCursor.FromStorage(
                    item.Sequence.Value);
            }

            if (batch.Events.Count == 0)
            {
                cursor = batch.Current;
                await Task.Delay(
                    WorkspaceWatchPollInterval,
                    context.RequestAborted);
            }
        }
    }
}
