namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses;

internal static partial class TenancyResponses
{
    internal static V1.ResourceState MapResourceState(
        Domain.Resources.ResourceState state) =>
        state switch
        {
            Domain.Resources.ResourceState.Active =>
                V1.ResourceState.Active,
            Domain.Resources.ResourceState.Suspended =>
                V1.ResourceState.Suspended,
            Domain.Resources.ResourceState.Deleted =>
                V1.ResourceState.Deleted,
            _ => throw new InvalidOperationException(
                "Resource state is invalid")
        };
}
