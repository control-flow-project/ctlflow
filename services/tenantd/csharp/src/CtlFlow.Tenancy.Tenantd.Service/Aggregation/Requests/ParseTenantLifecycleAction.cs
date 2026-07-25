using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<LifecycleActionCommand>
        ParseTenantLifecycleAction(
            TenantId tenantId,
            LifecycleActionDocument document,
            LifecycleOperationKind operation,
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
        return new LifecycleActionCommand(
            new LifecycleTarget.Tenant(tenantId),
            operation,
            resourceVersion,
            actor,
            idempotencyKey,
            CalculateRequestDigest(
            [
                "tenant_lifecycle",
                tenantId.Value,
                ((int)operation).ToString(
                    System.Globalization.CultureInfo.InvariantCulture),
                resourceVersion.Value.ToString(
                    System.Globalization.CultureInfo.InvariantCulture)
            ]));
    }
}
