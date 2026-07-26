using CtlFlow.Tenancy.Tenantd.Domain.Resources;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Requests;

internal static partial class TenancyRequests
{
    internal static ValueTask<ResourceState> ParseResourceState(
        V1.ResourceState state,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(state switch
        {
            V1.ResourceState.Active => ResourceState.Active,
            V1.ResourceState.Suspended => ResourceState.Suspended,
            V1.ResourceState.Deleted => ResourceState.Deleted,
            _ => throw new ArgumentException("Resource state is invalid")
        });
    }
}
