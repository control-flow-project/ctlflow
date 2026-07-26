using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Runs;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Time;

namespace CtlFlow.Identity.Identityd.Domain.Invocations;

public static partial class Invocations
{
    public static ValueTask<InvocationIssueResult> CreateRunInvocation(
        PrincipalLookupResult principal,
        IdentityTarget target,
        RunId runId,
        UtcInstant now,
        InvocationLifetime lifetime,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (principal is not PrincipalLookupResult.Found found
            || !found.Facts.PrincipalEnabled
            || !found.Facts.SubjectAccountEnabled)
        {
            return ValueTask.FromResult<InvocationIssueResult>(
                new InvocationIssueResult.NotFound());
        }

        var actor = found.Facts.PrincipalKind == PrincipalKind.Virtual
            ? found.Facts.PrincipalId
            : null;
        var issuedAt = now.ToWholeSecond();
        return ValueTask.FromResult<InvocationIssueResult>(
            new InvocationIssueResult.Issued(new InvocationClaims(
                found.Facts.SubjectAccountId,
                actor,
                target,
                new InvocationOrigin.Run(runId),
                InvocationTokenId.Generate(),
                issuedAt,
                issuedAt.Add(lifetime.Value))));
    }
}
