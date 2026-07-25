using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.Tenants;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures.AggregationFailures;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests.AggregationRequests;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses.AggregationResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization.AggregationJson;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Tenants;

internal static partial class TenantRoutes
{
    private static readonly TimeSpan TenantWatchPollInterval =
        TimeSpan.FromMilliseconds(50);

    internal static async Task ListOrWatchTenants(HttpContext context)
    {
        var request = await ParseCollectionRequest(
            context.Request,
            context.RequestAborted);
        if (request is AggregationCollectionRequest.Watch watch)
        {
            await WatchTenants(context, watch.Cursor);
            return;
        }

        var list = (AggregationCollectionRequest.List)request;
        var identity = context.Features.Get<AggregationRequestIdentity>()
            ?? throw new InvalidOperationException(
                "Aggregation identity is unavailable");
        var settings = context.RequestServices.GetRequiredService<
            TenantOperationSettings>();
        var result = await ListTenantResources(
            context.RequestServices.GetRequiredService<
                IDbContextFactory<TenantDbContext>>(),
            list.PageSize,
            list.PageToken,
            identity.Actor,
            RequestDigest.Calculate("operator:tenants"),
            settings.PageCursorLifetime,
            UtcInstant.FromClock(DateTimeOffset.UtcNow),
            context.RequestAborted);
        if (result is ResourceListResult<TenantResource>.ExpiredPageToken)
        {
            throw CreateAggregationFailure(
                StatusCodes.Status410Gone,
                "Expired",
                "The Tenant continuation has expired",
                "tenants");
        }

        var page =
            ((ResourceListResult<TenantResource>.Page)result).Value;
        var json = context.RequestServices.GetRequiredService<
            TenancyJsonContext>();
        await WriteJsonDocument(
            context.Response,
            StatusCodes.Status200OK,
            CreateTenantListDocument(page),
            json.TenantListDocument,
            context.RequestAborted);
    }

    private static async Task WatchTenants(
        HttpContext context,
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
            var read = await ReadTenantResourceEvents(
                database,
                cursor,
                context.RequestAborted);
            if (read is
                ResourceWatchReadResult<TenantResource>.InvalidCursor)
            {
                throw CreateAggregationFailure(
                    StatusCodes.Status400BadRequest,
                    "Invalid",
                    "The Tenant watch cursor is invalid",
                    "tenants");
            }

            if (read is
                ResourceWatchReadResult<TenantResource>.ExpiredCursor)
            {
                throw CreateAggregationFailure(
                    StatusCodes.Status410Gone,
                    "Expired",
                    "The Tenant watch cursor has expired",
                    "tenants");
            }

            var batch =
                (ResourceWatchReadResult<TenantResource>.Batch)read;
            foreach (var item in batch.Events)
            {
                await WriteTenantWatchEvent(
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
                    TenantWatchPollInterval,
                    context.RequestAborted);
            }
        }
    }
}
