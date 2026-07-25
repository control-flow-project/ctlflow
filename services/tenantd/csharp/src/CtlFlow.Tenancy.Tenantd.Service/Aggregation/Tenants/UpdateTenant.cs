using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.Tenants;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditCorrelations;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures.AggregationFailures;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests.AggregationRequests;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses.AggregationResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization.AggregationJson;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Tenants;

internal static partial class TenantRoutes
{
    internal static async Task UpdateTenant(HttpContext context)
    {
        var cancellation = context.RequestAborted;
        var tenantId = await ParseTenantId(
            context.Request.RouteValues["tenantId"] as string
                ?? string.Empty,
            "tenantId",
            cancellation);
        var database = context.RequestServices.GetRequiredService<
            IDbContextFactory<TenantDbContext>>();
        var current = await QueryTenantResource(
            database,
            tenantId,
            cancellation);
        if (current is not ResourceLookupResult<TenantResource>.Found found)
        {
            throw CreateAggregationFailure(
                StatusCodes.Status404NotFound,
                "NotFound",
                "The requested Tenant was not found",
                "tenants",
                tenantId.Value);
        }

        var identity = context.Features.Get<AggregationRequestIdentity>()
            ?? throw new InvalidOperationException(
                "Aggregation identity is unavailable");
        var json = context.RequestServices.GetRequiredService<
            TenancyJsonContext>();
        var document = await ReadJsonDocument(
            context.Request,
            json.TenantDocument,
            cancellation);
        var idempotencyKey = await ParseIdempotencyKey(
            context.Request,
            cancellation);
        var command = await ParseUpdateTenant(
            document,
            found.Resource,
            identity.Actor,
            idempotencyKey,
            cancellation);
        var auditCorrelation = await CreateAuditCorrelation(
            Activity.Current,
            cancellation);
        var result = await UpdateTenantResource(
            database,
            command,
            auditCorrelation,
            UtcInstant.FromClock(DateTimeOffset.UtcNow),
            cancellation);
        await WriteTenantMutationResult(
            context.Response,
            result,
            StatusCodes.Status200OK,
            json,
            cancellation);
    }
}
