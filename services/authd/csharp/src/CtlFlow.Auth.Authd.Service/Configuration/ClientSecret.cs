namespace CtlFlow.Auth.Authd.Service.Configuration;

internal sealed class ClientSecret
{
    private readonly string _material;

    internal ClientSecret(string material) => _material = material;

    internal string ReadForBasicAuthentication() => _material;

    public override string ToString() => "[REDACTED]";
}
