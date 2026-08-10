using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Identity.Identityd.Domain.Collections.Pages;

namespace CtlFlow.Identity.Identityd.Db.LoginProviders;

public static partial class LoginProviders
{
    public static async Task<Page<LoginProvider>> ListLoginProviders(
        IdentityDatabase identityDatabase,
        TenantId tenantId,
        PageSize pageSize,
        ProviderId? afterProviderId,
        CancellationToken cancellation)
    {
        using var activity = IdentityDbTelemetry.StartOperation(
            "list_login_providers");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var tenantValue = tenantId.Value;
        var afterValue = afterProviderId?.Value ?? string.Empty;
        var take = pageSize.Value + 1;
        var queryCancellation = cancellation;
        var providers = await database.LoginProviders
            .AsNoTracking()
            .Where(candidate =>
                EF.Property<string>(candidate, "_tenantId") == tenantValue
                && candidate.State != LoginProviderState.Deleted
                && string.Compare(
                    EF.Property<string>(candidate, "_providerId"),
                    afterValue) > 0)
            .OrderBy(candidate =>
                EF.Property<string>(candidate, "_providerId"))
            .Select(candidate => new
            {
                TenantId = EF.Property<string>(candidate, "_tenantId"),
                ProviderId = EF.Property<string>(candidate, "_providerId"),
                DisplayName = EF.Property<string>(candidate, "_displayName"),
                ConfigurationId = EF.Property<string>(
                    candidate,
                    "_configurationId"),
                ConfigurationVersionId = EF.Property<string>(
                    candidate,
                    "_configurationVersionId"),
                SecretId = EF.Property<string>(candidate, "_secretId"),
                SecretVersionId = EF.Property<string>(
                    candidate,
                    "_secretVersionId"),
                candidate.State,
                candidate.Revision
            })
            .Take(take)
            .ToListAsync(queryCancellation);
        var mappedProviders = providers
            .Select(provider => new LoginProvider(
                Domain.Tenants.TenantId.FromStorage(provider.TenantId),
                Domain.IdentityLinks.ProviderId.FromStorage(
                    provider.ProviderId),
                ProviderDisplayName.FromStorage(provider.DisplayName),
                ConfigurationId.FromStorage(provider.ConfigurationId),
                ConfigurationVersionId.FromStorage(
                    provider.ConfigurationVersionId),
                SecretId.FromStorage(provider.SecretId),
                SecretVersionId.FromStorage(provider.SecretVersionId),
                provider.State,
                provider.Revision))
            .ToArray();
        return await CreatePage(
            mappedProviders,
            pageSize,
            provider => provider.ProviderId.Value,
            cancellation);
    }
}
