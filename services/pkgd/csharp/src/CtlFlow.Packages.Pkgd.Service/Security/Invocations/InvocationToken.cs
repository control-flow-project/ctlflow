namespace CtlFlow.Packages.Pkgd.Service.Security.Invocations;

internal sealed class InvocationToken(string material)
{
    internal string ReadForPolicyForwarding() => material;

    public override string ToString() => "[REDACTED INVOCATION TOKEN]";
}
