using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Sessions;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Sessions;

public static partial class Sessions
{
    public static async Task<SessionFacts?> FindSession(
        IdentityDatabase identityDatabase,
        SessionCredentialDigest credentialDigest,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity =
            IdentityDbTelemetry.StartOperation("find_session");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var digestValue = credentialDigest.Value;
        var queryCancellation = cancellation;
        var row = await database.Sessions
            .AsNoTracking()
            .Where(session =>
                EF.Property<string>(session, "_credentialDigest")
                    == digestValue)
            .Select(session => new
            {
                Id = EF.Property<string>(session, "_id"),
                AccountId = EF.Property<string>(session, "_accountId"),
                TenantId = EF.Property<string>(session, "_tenantId"),
                ProviderId = EF.Property<string>(session, "_providerId"),
                session.ExpiresAt,
                session.RevokedAt,
                session.Revision
            })
            .SingleOrDefaultAsync(queryCancellation);
        return row is null
            ? null
            : new SessionFacts(
                SessionId.FromStorage(row.Id),
                Domain.Accounts.AccountId.FromStorage(row.AccountId),
                Domain.Tenants.TenantId.FromStorage(row.TenantId),
                Domain.IdentityLinks.ProviderId.FromStorage(row.ProviderId),
                row.ExpiresAt,
                row.RevokedAt,
                row.Revision);
    }
}
