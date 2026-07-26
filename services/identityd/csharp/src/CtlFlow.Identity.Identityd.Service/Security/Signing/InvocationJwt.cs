namespace CtlFlow.Identity.Identityd.Service.Security.Signing;

internal sealed class InvocationJwt
{
    private readonly string _material;

    internal InvocationJwt(string material)
    {
        _material = material;
    }

    internal string ReadForResponse() => _material;

    public override string ToString() => "[REDACTED]";
}
