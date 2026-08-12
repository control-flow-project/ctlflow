using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.LoginProviders;

public static partial class LoginProviders
{
    public static async Task<IdentityMutation<LoginProvider>>
        CreateLoginProvider(
            IdentityDatabase identityDatabase,
            TenantId tenantId,
            ProviderId providerId,
            ProviderDisplayName displayName,
            ConfigurationId configurationId,
            ConfigurationVersionId configurationVersionId,
            SecretId secretId,
            SecretVersionId secretVersionId,
            AuditContext audit,
            CancellationToken cancellation)
    {
        await using var mutation =
            await identityDatabase.AcquireMutation(cancellation);
        using var activity = IdentityDbTelemetry.StartOperation(
            "create_login_provider");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var tenantValue = tenantId.Value;
        var providerValue = providerId.Value;
        var queryCancellation = cancellation;
        var existing = await database.LoginProviders.SingleOrDefaultAsync(
            candidate =>
                EF.Property<string>(candidate, "_tenantId") == tenantValue
                && EF.Property<string>(candidate, "_providerId")
                    == providerValue,
            queryCancellation);
        var result = await Domain.Providers.LoginProviders.CreateLoginProvider(
            existing,
            tenantId,
            providerId,
            displayName,
            configurationId,
            configurationVersionId,
            secretId,
            secretVersionId,
            audit,
            cancellation);
        database.LoginProviders.Add(result.Value);
        await database.SaveChangesAsync(cancellation);
        return result;
    }
}
