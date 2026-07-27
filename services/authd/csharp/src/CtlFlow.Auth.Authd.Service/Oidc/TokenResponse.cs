namespace CtlFlow.Auth.Authd.Service.Oidc;

internal sealed class TokenResponse(
    AccessToken accessToken,
    string idToken)
{
    internal AccessToken AccessToken { get; } = accessToken;

    internal string ReadIdToken() => idToken;

    public override string ToString() => "[REDACTED]";
}
