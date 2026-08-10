using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Db.Principals;

internal static partial class PrincipalQueries
{
    internal static async Task<PrincipalFacts?> LoadPrincipalFacts(
        IdentityDatabase identityDatabase,
        PrincipalId principalId,
        IdentityTarget target,
        CancellationToken cancellation)
    {
        var result = await Principals.ResolvePrincipal(
            identityDatabase,
            principalId,
            target,
            cancellation);
        return result is PrincipalLookupResult.Found found
            ? found.Facts
            : null;
    }
}
