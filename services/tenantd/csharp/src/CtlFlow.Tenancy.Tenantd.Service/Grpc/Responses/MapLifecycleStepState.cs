using DomainLifecycleStepState =
    CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleStepState;
using WireLifecycleStepState = CtlFlow.Tenancy.V1.LifecycleStepState;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses;

internal static partial class LifecycleResponses
{
    internal static WireLifecycleStepState MapLifecycleStepState(
        DomainLifecycleStepState state) =>
        state switch
        {
            DomainLifecycleStepState.Pending =>
                WireLifecycleStepState.Pending,
            DomainLifecycleStepState.Blocked =>
                WireLifecycleStepState.Blocked,
            DomainLifecycleStepState.Complete =>
                WireLifecycleStepState.Complete,
            _ => throw new InvalidOperationException(
                "Lifecycle step state is invalid")
        };
}
