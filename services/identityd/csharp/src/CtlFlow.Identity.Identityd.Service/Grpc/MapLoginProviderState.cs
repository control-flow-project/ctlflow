using CtlFlow.Identity.Identityd.Domain.Providers;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal static partial class IdentityResponses
{
    internal static CtlFlow.Identity.V1.LoginProviderState
        MapLoginProviderState(LoginProviderState state) => state switch
        {
            LoginProviderState.Active =>
                CtlFlow.Identity.V1.LoginProviderState.Active,
            LoginProviderState.Disabled =>
                CtlFlow.Identity.V1.LoginProviderState.Disabled,
            LoginProviderState.Deleted =>
                CtlFlow.Identity.V1.LoginProviderState.Deleted,
            _ => throw new InvalidOperationException(
                "Login-provider state is not supported")
        };
}
