namespace CtlFlow.Policy.Policyd.Service.Security.Invocations;

internal sealed class InvocationToken(string material)
{
    internal string ReadForIdentityForwarding() => material;

    public override string ToString() => "[REDACTED INVOCATION TOKEN]";
}
