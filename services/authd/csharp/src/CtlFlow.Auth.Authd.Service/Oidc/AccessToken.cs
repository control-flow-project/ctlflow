namespace CtlFlow.Auth.Authd.Service.Oidc;

internal sealed class AccessToken(string material)
{
    internal string ReadForUserInfo() => material;

    public override string ToString() => "[REDACTED]";
}
