using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;
using static CtlFlow.Identity.Identityd.Domain.Invocations.Invocations;

namespace CtlFlow.Identity.Identityd.Domain.Invocations;

public static partial class Invocations
{
    public static async ValueTask<bool> CanResolvePrincipal(
        InvocationIdentity invocation,
        PrincipalId principalId,
        IdentityTarget target,
        CancellationToken cancellation)
    {
        return invocation.Actor == principalId
            && await ContainsTarget(invocation, target, cancellation);
    }
}
