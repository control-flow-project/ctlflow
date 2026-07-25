using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<RetryLifecycleCommand>
        ParseRetryLifecycle(
            LifecycleTarget target,
            LifecycleActionDocument document,
            RequestActor actor,
            IdempotencyKey idempotencyKey,
            CancellationToken cancellation)
    {
        await ValidateTypeMetadata(
            document.ApiVersion,
            document.Kind,
            "LifecycleAction",
            cancellation);
        var resourceVersion = await ParseResourceVersion(
            document.ResourceVersion,
            "resourceVersion",
            cancellation);
        var targetFields = target switch
        {
            LifecycleTarget.Tenant tenant =>
                new[] { "tenant", tenant.TenantId.Value },
            LifecycleTarget.Workspace workspace =>
            [
                "workspace",
                workspace.TenantId.Value,
                workspace.WorkspaceId.Value
            ],
            _ => throw new InvalidOperationException(
                "Lifecycle target is invalid")
        };
        return new RetryLifecycleCommand(
            target,
            resourceVersion,
            actor,
            idempotencyKey,
            CalculateRequestDigest(
                new[] { "retry_lifecycle" }
                    .Concat(targetFields)
                    .Append(resourceVersion.Value.ToString(
                        System.Globalization.CultureInfo.InvariantCulture))));
    }
}
