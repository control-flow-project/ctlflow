using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Invocations;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Runs;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Time;
using IdentityPrincipals =
    CtlFlow.Identity.Identityd.Db.Principals.Principals;

namespace CtlFlow.Identity.Identityd.Db.Invocations;

public static partial class Invocations
{
    public static async Task<InvocationIssueResult> CreateRunInvocation(
        IdentityDatabase identityDatabase,
        PrincipalId principalId,
        IdentityTarget target,
        RunId runId,
        UtcInstant now,
        InvocationLifetime lifetime,
        CancellationToken cancellation)
    {
        var principal = await IdentityPrincipals.ResolvePrincipal(
            identityDatabase,
            principalId,
            target,
            cancellation);
        return await Domain.Invocations.Invocations.CreateRunInvocation(
            principal,
            target,
            runId,
            now,
            lifetime,
            cancellation);
    }
}
