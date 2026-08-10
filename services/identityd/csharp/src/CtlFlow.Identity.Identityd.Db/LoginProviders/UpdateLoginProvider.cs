using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.LoginProviders;

public static partial class LoginProviders
{
    public static async Task<IdentityMutation<LoginProvider>>
        UpdateLoginProvider(
            IdentityDatabase identityDatabase,
            TenantId tenantId,
            ProviderId providerId,
            Revision expectedRevision,
            ProviderDisplayName displayName,
            ConfigurationId configurationId,
            ConfigurationVersionId configurationVersionId,
            SecretId secretId,
            SecretVersionId secretVersionId,
            AuditContext audit,
            CancellationToken cancellation)
    {
        await using var mutation = await identityDatabase.AcquireMutation(
            $"login-provider:{tenantId.Value}:{providerId.Value}",
            cancellation);
        using var activity = IdentityDbTelemetry.StartOperation(
            "update_login_provider");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var tenantValue = tenantId.Value;
        var providerValue = providerId.Value;
        var queryCancellation = cancellation;
        var provider = await database.LoginProviders.SingleOrDefaultAsync(
            candidate =>
                EF.Property<string>(candidate, "_tenantId") == tenantValue
                && EF.Property<string>(candidate, "_providerId")
                    == providerValue,
            queryCancellation);
        var result = await Domain.Providers.LoginProviders.UpdateLoginProvider(
            provider,
            expectedRevision,
            displayName,
            configurationId,
            configurationVersionId,
            secretId,
            secretVersionId,
            audit,
            cancellation);
        if (result.AuditIntent is not null)
        {
            await database.SaveChangesAsync(cancellation);
        }

        return result;
    }
}
