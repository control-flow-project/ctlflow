using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;

namespace CtlFlow.Identity.Identityd.Domain.Providers;

public static partial class LoginProviders
{
    public static ValueTask<IdentityMutation<LoginProvider>>
        CreateLoginProvider(
            LoginProvider? existing,
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
        cancellation.ThrowIfCancellationRequested();
        if (existing is not null)
        {
            throw new IdentityAlreadyExistsException();
        }

        var provider = new LoginProvider(
            tenantId,
            providerId,
            displayName,
            configurationId,
            configurationVersionId,
            secretId,
            secretVersionId,
            LoginProviderState.Active,
            Revision.Initial());
        return ValueTask.FromResult(
            new IdentityMutation<LoginProvider>(
                provider,
                CreateProviderAudit(
                    provider,
                    LoginProviderAuditAction.Created,
                    audit)));
    }

    private static LoginProviderAuditIntent CreateProviderAudit(
        LoginProvider provider,
        LoginProviderAuditAction action,
        AuditContext audit) => new(
        AuditEventId.Generate(),
        audit.Attribution,
        provider.TenantId,
        provider.ProviderId,
        provider.Revision,
        provider.State,
        action,
        audit.Correlation,
        audit.OccurredAt);
}
