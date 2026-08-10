using CtlFlow.Identity.Identityd.Domain.Providers;

namespace CtlFlow.Identity.Identityd.Db.LoginProviders;

internal static class LoginProviderStates
{
    internal static int ToStorage(LoginProviderState value) => value switch
    {
        (LoginProviderState)0 => 0,
        LoginProviderState.Active => 1,
        LoginProviderState.Disabled => 2,
        LoginProviderState.Deleted => 3,
        _ => throw new InvalidOperationException(
            "Login-provider state is not supported")
    };

    internal static LoginProviderState FromStorage(int value) => value switch
    {
        1 => LoginProviderState.Active,
        2 => LoginProviderState.Disabled,
        3 => LoginProviderState.Deleted,
        _ => throw new InvalidOperationException(
            "Stored login-provider state is invalid")
    };
}
