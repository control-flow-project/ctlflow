using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Db.Principals;

public static partial class Principals
{
    public static async Task<PrincipalLookupResult> ResolvePrincipal(
        IdentityDatabase identityDatabase,
        PrincipalId principalId,
        IdentityTarget target,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return principalId.Kind switch
        {
            PrincipalKind.Human or PrincipalKind.Service =>
                await ResolveAccount(
                    identityDatabase,
                    principalId,
                    target,
                    cancellation),
            PrincipalKind.Virtual => await ResolveVirtual(
                identityDatabase,
                principalId,
                target,
                cancellation),
            _ => throw new InvalidOperationException(
                "Unknown principal kind")
        };
    }
}
