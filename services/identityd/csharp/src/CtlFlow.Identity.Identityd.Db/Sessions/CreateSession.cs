using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Sessions;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Providers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Sessions;

public static partial class Sessions
{
    public static async Task<SessionCreationResult> CreateSession(
        IdentityDatabase identityDatabase,
        TenantId tenantId,
        ProviderId providerId,
        ProviderSubject providerSubject,
        SessionCredentialDigest credentialDigest,
        SessionLifetime lifetime,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity =
            IdentityDbTelemetry.StartOperation("create_session");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var tenantIdValue = tenantId.Value;
        var providerIdValue = providerId.Value;
        var providerSubjectValue = providerSubject.Value;
        var queryCancellation = cancellation;
        var link = await database.ExternalIdentityLinks
            .AsNoTracking()
            .Where(candidate =>
                EF.Property<string>(candidate, "_tenantId")
                    == tenantIdValue
                && EF.Property<string>(candidate, "_providerId")
                    == providerIdValue
                && EF.Property<string>(candidate, "_providerSubject")
                    == providerSubjectValue)
            .Select(candidate => new
            {
                AccountId = EF.Property<string>(
                    candidate,
                    "_accountId"),
                TenantId = EF.Property<string>(
                    candidate,
                    "_tenantId")
            })
            .SingleOrDefaultAsync(queryCancellation);
        ExternalIdentityFacts? identity = null;
        if (link is not null)
        {
            var provider = await database.LoginProviders
                .AsNoTracking()
                .Where(candidate =>
                    EF.Property<string>(candidate, "_tenantId")
                        == tenantIdValue
                    && EF.Property<string>(candidate, "_providerId")
                        == providerIdValue)
                .Select(candidate => candidate.State)
                .SingleOrDefaultAsync(queryCancellation);
            var accountIdValue = link.AccountId;
            var account = await database.Accounts
                .AsNoTracking()
                .Where(candidate =>
                    EF.Property<string>(candidate, "_id")
                        == accountIdValue)
                .Select(candidate => new
                {
                    Id = EF.Property<string>(candidate, "_id"),
                    candidate.Kind,
                    candidate.Enabled
                })
                .SingleOrDefaultAsync(queryCancellation);
            var membership = await database.TenantMemberships
                .AsNoTracking()
                .Where(candidate =>
                    EF.Property<string>(candidate, "_accountId")
                        == accountIdValue
                    && EF.Property<string>(candidate, "_tenantId")
                        == tenantIdValue)
                .Select(candidate => new
                {
                    AccountId = EF.Property<string>(
                        candidate,
                        "_accountId"),
                    TenantId = EF.Property<string>(
                        candidate,
                        "_tenantId")
                })
                .SingleOrDefaultAsync(queryCancellation);
            if (account is not null && membership is not null)
            {
                identity = new ExternalIdentityFacts(
                    AccountId.FromStorage(account.Id),
                    account.Kind,
                    account.Enabled,
                    provider == LoginProviderState.Active,
                    TenantId.FromStorage(link.TenantId),
                    TenantId.FromStorage(membership.TenantId));
            }
        }

        var creationResult =
            await Domain.Sessions.Sessions.CreateSession(
            identity,
            providerId,
            credentialDigest,
            lifetime,
            audit,
            cancellation);
        if (creationResult
            is not SessionCreationResult.Created created)
        {
            return creationResult;
        }

        var creation = created.Creation;
        database.Sessions.Add(creation.Session);
        try
        {
            await database.SaveChangesAsync(cancellation);
            return new SessionCreationResult.Created(creation);
        }
        catch (DbUpdateException exception)
        {
            throw new InvalidOperationException(
                "Session identity generation collided",
                exception);
        }
    }
}
