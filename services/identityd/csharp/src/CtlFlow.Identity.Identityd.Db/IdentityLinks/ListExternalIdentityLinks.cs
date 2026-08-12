using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Identity.Identityd.Domain.Collections.Pages;
using static CtlFlow.Identity.Identityd.Domain.IdentityLinks.ProviderSubjects;

namespace CtlFlow.Identity.Identityd.Db.IdentityLinks;

public static partial class IdentityLinks
{
    public static async Task<Page<ExternalIdentityLink>>
        ListExternalIdentityLinks(
            IdentityDatabase identityDatabase,
            TenantId tenantId,
            ProviderId providerId,
            PageSize pageSize,
            ProviderSubject? afterProviderSubject,
            CancellationToken cancellation)
    {
        using var activity = IdentityDbTelemetry.StartOperation(
            "list_external_identity_links");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var tenantValue = tenantId.Value;
        var providerValue = providerId.Value;
        var afterValue = afterProviderSubject?.Value ?? string.Empty;
        var take = pageSize.Value + 1;
        var queryCancellation = cancellation;
        var links = await database.ExternalIdentityLinks
            .AsNoTracking()
            .Where(candidate =>
                EF.Property<string>(candidate, "_tenantId") == tenantValue
                && EF.Property<string>(candidate, "_providerId")
                    == providerValue
                && string.Compare(
                    EF.Property<string>(candidate, "_providerSubject"),
                    afterValue) > 0)
            .OrderBy(candidate =>
                EF.Property<string>(candidate, "_providerSubject"))
            .Select(candidate => new
            {
                ExternalLinkId = EF.Property<string>(
                    candidate,
                    "_externalLinkId"),
                TenantId = EF.Property<string>(candidate, "_tenantId"),
                ProviderId = EF.Property<string>(candidate, "_providerId"),
                ProviderSubject = EF.Property<string>(
                    candidate,
                    "_providerSubject"),
                AccountId = EF.Property<string>(candidate, "_accountId"),
                candidate.Revision
            })
            .Take(take)
            .ToListAsync(queryCancellation);
        var mappedLinks = links
            .Select(link => new ExternalIdentityLink(
                ExternalLinkId.FromStorage(link.ExternalLinkId),
                Domain.Tenants.TenantId.FromStorage(link.TenantId),
                Domain.Providers.ProviderId.FromStorage(link.ProviderId),
                ProviderSubject.FromStorage(link.ProviderSubject),
                Domain.Accounts.AccountId.FromStorage(link.AccountId),
                link.Revision))
            .ToArray();
        return await CreatePage(
            mappedLinks,
            pageSize,
            link => link.ProviderSubject.Value,
            cancellation,
            CompareProviderSubjects);
    }
}
