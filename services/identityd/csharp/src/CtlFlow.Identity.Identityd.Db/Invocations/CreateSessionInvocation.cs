using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Invocations;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Sessions;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Time;
using IdentityPrincipals =
    CtlFlow.Identity.Identityd.Db.Principals.Principals;
using IdentitySessions =
    CtlFlow.Identity.Identityd.Db.Sessions.Sessions;
using IdentityLoginProviders =
    CtlFlow.Identity.Identityd.Db.LoginProviders.LoginProviders;

namespace CtlFlow.Identity.Identityd.Db.Invocations;

public static partial class Invocations
{
    public static async Task<InvocationIssueResult>
        CreateSessionInvocation(
            IdentityDatabase identityDatabase,
            SessionCredentialDigest credentialDigest,
            IdentityTarget target,
            UtcInstant now,
            InvocationLifetime lifetime,
            CancellationToken cancellation)
    {
        var session = await IdentitySessions.FindSession(
            identityDatabase,
            credentialDigest,
            cancellation);
        PrincipalLookupResult principal = session is null
            ? new PrincipalLookupResult.NotFound()
            : await IdentityPrincipals.ResolvePrincipal(
                identityDatabase,
                await PrincipalId.Parse(
                    session.AccountId.Value,
                    cancellation),
                target,
                cancellation);
        var providerAdmitted = session is null
            || target.WorkspaceId is null
            || await IdentityLoginProviders
                .HasWorkspaceLoginProviderAdmission(
                    identityDatabase,
                    target.TenantId,
                    target.WorkspaceId,
                    session.ProviderId,
                    cancellation);
        return await Domain.Invocations.Invocations.CreateSessionInvocation(
            session,
            principal,
            providerAdmitted,
            target,
            now,
            lifetime,
            cancellation);
    }
}
