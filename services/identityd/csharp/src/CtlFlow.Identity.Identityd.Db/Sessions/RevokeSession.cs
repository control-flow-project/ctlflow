using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Sessions;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Sessions;

public static partial class Sessions
{
    public static async Task<SessionRevocationResult> RevokeSession(
        IdentityDatabase identityDatabase,
        SessionCredentialDigest credentialDigest,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity =
            IdentityDbTelemetry.StartOperation("revoke_session");
        await using var mutation =
            await identityDatabase.AcquireMutation(cancellation);
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var digestValue = credentialDigest.Value;
        var queryCancellation = cancellation;
        var row = await database.Sessions
            .AsNoTracking()
            .Where(candidate =>
                EF.Property<string>(candidate, "_credentialDigest")
                    == digestValue)
            .Select(candidate => new
            {
                Id = EF.Property<string>(candidate, "_id"),
                CredentialDigest = EF.Property<string>(
                    candidate,
                    "_credentialDigest"),
                AccountId = EF.Property<string>(
                    candidate,
                    "_accountId"),
                TenantId = EF.Property<string>(
                    candidate,
                    "_tenantId"),
                ProviderId = EF.Property<string>(
                    candidate,
                    "_providerId"),
                candidate.CreatedAt,
                candidate.ExpiresAt,
                candidate.RevokedAt,
                candidate.Revision
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (row is null)
        {
            return new SessionRevocationResult.Unauthenticated();
        }

        var session = new Session(
            SessionId.FromStorage(row.Id),
            SessionCredentialDigest.FromStorage(
                row.CredentialDigest),
            Domain.Accounts.AccountId.FromStorage(row.AccountId),
            Domain.Tenants.TenantId.FromStorage(row.TenantId),
            Domain.Providers.ProviderId.FromStorage(row.ProviderId),
            row.CreatedAt,
            row.ExpiresAt,
            row.RevokedAt,
            row.Revision);
        database.Attach(session);
        var revocation = await Domain.Sessions.Sessions.RevokeSession(
            session,
            audit,
            cancellation);
        if (revocation.AuditIntent is null)
        {
            return new SessionRevocationResult.Found(revocation);
        }

        try
        {
            await database.SaveChangesAsync(cancellation);
            return new SessionRevocationResult.Found(revocation);
        }
        catch (DbUpdateConcurrencyException)
        {
            await using var currentDatabase =
                await identityDatabase.Contexts.CreateDbContextAsync(
                    cancellation);
            var currentRow = await currentDatabase.Sessions
                .AsNoTracking()
                .Where(candidate =>
                    EF.Property<string>(
                        candidate,
                        "_credentialDigest") == digestValue)
                .Select(candidate => new
                {
                    Id = EF.Property<string>(candidate, "_id"),
                    CredentialDigest = EF.Property<string>(
                        candidate,
                        "_credentialDigest"),
                    AccountId = EF.Property<string>(
                        candidate,
                        "_accountId"),
                    TenantId = EF.Property<string>(
                        candidate,
                        "_tenantId"),
                    ProviderId = EF.Property<string>(
                        candidate,
                        "_providerId"),
                    candidate.CreatedAt,
                    candidate.ExpiresAt,
                    candidate.RevokedAt,
                    candidate.Revision
                })
                .SingleOrDefaultAsync(queryCancellation)
                ?? throw new InvalidOperationException(
                    "Session disappeared during revocation");
            var currentSession = new Session(
                SessionId.FromStorage(currentRow.Id),
                SessionCredentialDigest.FromStorage(
                    currentRow.CredentialDigest),
                Domain.Accounts.AccountId.FromStorage(
                    currentRow.AccountId),
                Domain.Tenants.TenantId.FromStorage(
                    currentRow.TenantId),
                Domain.Providers.ProviderId.FromStorage(
                    currentRow.ProviderId),
                currentRow.CreatedAt,
                currentRow.ExpiresAt,
                currentRow.RevokedAt,
                currentRow.Revision);
            var current = await Domain.Sessions.Sessions.RevokeSession(
                currentSession,
                audit,
                cancellation);
            if (current.AuditIntent is not null)
            {
                throw new InvalidOperationException(
                    "Session revocation conflict did not converge");
            }

            return new SessionRevocationResult.Found(current);
        }
    }
}
