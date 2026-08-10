using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.LoginProviders;

public static partial class LoginProviders
{
    public static async Task<LoginProvider> GetLoginProvider(
        IdentityDatabase identityDatabase,
        TenantId tenantId,
        ProviderId providerId,
        CancellationToken cancellation)
    {
        using var activity = IdentityDbTelemetry.StartOperation(
            "get_login_provider");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var tenantValue = tenantId.Value;
        var providerValue = providerId.Value;
        var queryCancellation = cancellation;
        var provider = await database.LoginProviders
            .AsNoTracking()
            .Where(candidate =>
                EF.Property<string>(candidate, "_tenantId") == tenantValue
                && EF.Property<string>(candidate, "_providerId")
                    == providerValue)
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
            .SingleOrDefaultAsync(queryCancellation);
        var mappedProvider = provider is null
            ? null
            : new LoginProvider(
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
                provider.Revision);
        return await Domain.Providers.LoginProviders.RequireLoginProvider(
            mappedProvider,
            tenantId,
            providerId,
            cancellation);
    }
}
