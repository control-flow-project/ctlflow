using CtlFlow.Identity.Identityd.Domain.Providers;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal static partial class IdentityRequests
{
    internal static ValueTask<LoginProviderState> ParseLoginProviderState(
        CtlFlow.Identity.V1.LoginProviderState state,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(state switch
        {
            CtlFlow.Identity.V1.LoginProviderState.Active =>
                LoginProviderState.Active,
            CtlFlow.Identity.V1.LoginProviderState.Disabled =>
                LoginProviderState.Disabled,
            CtlFlow.Identity.V1.LoginProviderState.Deleted =>
                LoginProviderState.Deleted,
            _ => throw new ArgumentException(
                "Login-provider state is required",
                nameof(state))
        });
    }
}
