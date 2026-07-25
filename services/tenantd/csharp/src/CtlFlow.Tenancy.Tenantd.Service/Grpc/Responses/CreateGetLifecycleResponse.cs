using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.V1;
using Google.Protobuf.WellKnownTypes;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses;

internal static partial class LifecycleResponses
{
    internal static ValueTask<GetLifecycleResponse> CreateGetLifecycleResponse(
        GetLifecycleResult result,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (result is GetLifecycleResult.NotFound)
        {
            throw new global::Grpc.Core.RpcException(
                new global::Grpc.Core.Status(
                global::Grpc.Core.StatusCode.NotFound,
                "Lifecycle target was not found"));
        }

        var fact = ((GetLifecycleResult.Found)result).Fact;
        var response = new GetLifecycleResponse
        {
            Target = CreateLifecycleTarget(fact.Target),
            Lifecycle = MapLifecycleState(fact.Lifecycle),
            ResourceRevision = checked((ulong)fact.ResourceRevision),
            ProvisioningGeneration =
                checked((ulong)fact.ProvisioningGeneration),
            CacheExpiresAt = Timestamp.FromDateTimeOffset(
                fact.CacheExpiry.Value)
        };
        if (fact.ParentTenantLifecycle is { } parentLifecycle)
        {
            response.ParentTenantLifecycle =
                MapLifecycleState(parentLifecycle);
        }

        if (fact.CurrentOperationId is { } operationId)
        {
            response.CurrentOperationId = operationId.Value;
        }

        return ValueTask.FromResult(response);
    }
}
