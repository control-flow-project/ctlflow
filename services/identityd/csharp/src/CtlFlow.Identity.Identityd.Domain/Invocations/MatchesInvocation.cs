using CtlFlow.Identity.Identityd.Domain.Principals;

namespace CtlFlow.Identity.Identityd.Domain.Invocations;

public static partial class Invocations
{
    public static ValueTask<bool> MatchesInvocation(
        InvocationIdentity invocation,
        PrincipalFacts facts,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            facts.PrincipalId == invocation.Actor
            && facts.SubjectAccountId == invocation.SubjectAccount
            && (
                facts.PrincipalKind == PrincipalKind.Virtual
                || facts.PrincipalId == facts.SubjectAccountId.Principal));
    }
}
