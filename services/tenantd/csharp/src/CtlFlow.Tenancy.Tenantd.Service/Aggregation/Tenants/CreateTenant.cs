using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.Tenants;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditCorrelations;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests.AggregationRequests;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses.AggregationResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization.AggregationJson;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Tenants;

internal static partial class TenantRoutes
{
    internal static async Task CreateTenant(HttpContext context)
    {
        var cancellation = context.RequestAborted;
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
        var command = await ParseCreateTenant(
            document,
            identity.Actor,
            idempotencyKey,
            cancellation);
        var auditCorrelation = await CreateAuditCorrelation(
            Activity.Current,
            cancellation);
        var result = await CreateTenantResource(
            context.RequestServices.GetRequiredService<
            IDbContextFactory<TenantDbContext>>(),
            command,
            auditCorrelation,
            UtcInstant.FromClock(DateTimeOffset.UtcNow),
            cancellation);
        await WriteTenantMutationResult(
            context.Response,
            result,
            StatusCodes.Status201Created,
            json,
            cancellation);
    }
}
