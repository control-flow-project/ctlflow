using DomainDesiredState =
    CtlFlow.Execution.Execd.Domain.Resources.DesiredState;
using WireDesiredState =
    CtlFlow.Execution.V1.DesiredState;

namespace CtlFlow.Execution.Execd.Service.Grpc.Requests;

internal static partial class ExecutionRequests
{
    internal static DomainDesiredState ParseDesiredState(
        WireDesiredState state) =>
        state switch
        {
            WireDesiredState.Active => DomainDesiredState.Active,
            WireDesiredState.Suspended =>
                DomainDesiredState.Suspended,
            WireDesiredState.Retired => DomainDesiredState.Retired,
            _ => throw new ArgumentException(
                "desired_state is required")
        };
}
