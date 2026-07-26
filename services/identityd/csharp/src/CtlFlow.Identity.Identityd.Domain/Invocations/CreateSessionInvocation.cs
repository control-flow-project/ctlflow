using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Sessions;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Time;

namespace CtlFlow.Identity.Identityd.Domain.Invocations;

public static partial class Invocations
{
    public static ValueTask<InvocationIssueResult> CreateSessionInvocation(
        SessionFacts? session,
        PrincipalLookupResult principal,
        IdentityTarget target,
        UtcInstant now,
        InvocationLifetime lifetime,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (session is null
            || session.RevokedAt is not null
            || session.ExpiresAt.Value <= now.Value)
        {
            return ValueTask.FromResult<InvocationIssueResult>(
                new InvocationIssueResult.Unauthenticated());
        }

        if (session.TenantId != target.TenantId)
        {
            return ValueTask.FromResult<InvocationIssueResult>(
                new InvocationIssueResult.NotFound());
        }

        if (principal is not PrincipalLookupResult.Found found
            || found.Facts.PrincipalKind != PrincipalKind.Human
            || found.Facts.PrincipalId.Value != session.AccountId.Value
            || found.Facts.SubjectAccountId != session.AccountId
            || !found.Facts.PrincipalEnabled
            || !found.Facts.SubjectAccountEnabled)
        {
            return ValueTask.FromResult<InvocationIssueResult>(
                new InvocationIssueResult.NotFound());
        }

        var issuedAt = now.ToWholeSecond();
        return ValueTask.FromResult<InvocationIssueResult>(
            new InvocationIssueResult.Issued(new InvocationClaims(
                session.AccountId,
                null,
                target,
                new InvocationOrigin.Session(session.Id),
                InvocationTokenId.Generate(),
                issuedAt,
                issuedAt.Add(lifetime.Value))));
    }
}
