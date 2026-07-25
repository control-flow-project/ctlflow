using System.Diagnostics;
using DomainLifecycleState =
    CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleState;
using WireLifecycleState = CtlFlow.Tenancy.V1.LifecycleState;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses;

internal static partial class LifecycleResponses
{
    internal static WireLifecycleState MapLifecycleState(
        DomainLifecycleState lifecycle) =>
        lifecycle switch
        {
            DomainLifecycleState.Provisioning =>
                WireLifecycleState.Provisioning,
            DomainLifecycleState.Active =>
                WireLifecycleState.Active,
            DomainLifecycleState.Suspending =>
                WireLifecycleState.Suspending,
            DomainLifecycleState.Suspended =>
                WireLifecycleState.Suspended,
            DomainLifecycleState.Resuming =>
                WireLifecycleState.Resuming,
            DomainLifecycleState.Deleting =>
                WireLifecycleState.Deleting,
            DomainLifecycleState.Failed =>
                WireLifecycleState.Failed,
            DomainLifecycleState.Deleted =>
                WireLifecycleState.Deleted,
            _ => throw new UnreachableException()
        };
}
