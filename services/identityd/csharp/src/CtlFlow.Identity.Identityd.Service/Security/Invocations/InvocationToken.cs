namespace CtlFlow.Identity.Identityd.Service.Security.Invocations;

internal sealed class InvocationToken(string material)
{
    internal string ReadForPolicyForwarding() => material;
}
