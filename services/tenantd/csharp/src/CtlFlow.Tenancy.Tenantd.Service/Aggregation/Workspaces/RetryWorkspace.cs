using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.Workspaces;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditCorrelations;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests.AggregationRequests;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses.AggregationResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization.AggregationJson;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Workspaces;

internal static partial class WorkspaceRoutes
{
    internal static async Task RetryWorkspace(HttpContext context)
    {
        var cancellation = context.RequestAborted;
        var database = context.RequestServices.GetRequiredService<
            IDbContextFactory<TenantDbContext>>();
        var workspace = await LoadWorkspaceForMutation(
            context,
            database,
            cancellation);
        var identity = context.Features.Get<AggregationRequestIdentity>()
            ?? throw new InvalidOperationException(
                "Aggregation identity is unavailable");
        var json = context.RequestServices.GetRequiredService<
            TenancyJsonContext>();
        var document = await ReadJsonDocument(
            context.Request,
            json.LifecycleActionDocument,
            cancellation);
        var idempotencyKey = await ParseIdempotencyKey(
            context.Request,
            cancellation);
        var command = await ParseRetryLifecycle(
            new LifecycleTarget.Workspace(
                workspace.TenantId,
                workspace.WorkspaceId),
            document,
            identity.Actor,
            idempotencyKey,
            cancellation);
        var auditCorrelation = await CreateAuditCorrelation(
            Activity.Current,
            cancellation);
        var result = await RetryWorkspaceLifecycleResource(
            database,
            command,
            auditCorrelation,
            UtcInstant.FromClock(DateTimeOffset.UtcNow),
            cancellation);
        await WriteWorkspaceMutationResult(
            context.Response,
            result,
            StatusCodes.Status202Accepted,
            json,
            cancellation);
    }
}
