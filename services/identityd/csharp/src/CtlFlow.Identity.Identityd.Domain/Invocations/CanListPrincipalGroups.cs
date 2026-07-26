using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;
using static CtlFlow.Identity.Identityd.Domain.Invocations.Invocations;

namespace CtlFlow.Identity.Identityd.Domain.Invocations;

public static partial class Invocations
{
    public static async ValueTask<bool> CanListPrincipalGroups(
        InvocationIdentity invocation,
        PrincipalId principalId,
        IdentityTarget target,
        CancellationToken cancellation)
    {
        var admittedPrincipal = principalId == invocation.Actor
            || (
                invocation.Actor.Kind == PrincipalKind.Virtual
                && principalId == invocation.SubjectAccount.Principal);
        return admittedPrincipal
            && await ContainsTarget(invocation, target, cancellation);
    }
}
