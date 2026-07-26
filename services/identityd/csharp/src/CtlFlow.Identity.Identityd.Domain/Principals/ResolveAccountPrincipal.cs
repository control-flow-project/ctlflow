using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Resources;

namespace CtlFlow.Identity.Identityd.Domain.Principals;

public static partial class Principals
{
    public static ValueTask<PrincipalLookupResult> ResolveAccountPrincipal(
        AccountId accountId,
        AccountKind storedKind,
        bool enabled,
        Revision revision,
        Revision? membershipRevision,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (accountId.Kind != storedKind)
        {
            throw new InvalidOperationException(
                "Stored account kind does not match its principal ID");
        }

        return ValueTask.FromResult<PrincipalLookupResult>(
            membershipRevision is null
                ? new PrincipalLookupResult.NotFound()
                : new PrincipalLookupResult.Found(
                    new PrincipalFacts(
                        accountId.Principal,
                        storedKind == AccountKind.Human
                            ? PrincipalKind.Human
                            : PrincipalKind.Service,
                        enabled,
                        revision,
                        accountId,
                        enabled,
                        revision,
                        membershipRevision)));
    }
}
