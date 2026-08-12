using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Resources;

namespace CtlFlow.Identity.Identityd.Domain.Providers;

public static partial class LoginProviders
{
    public static ValueTask<IdentityMutation<LoginProvider>>
        UpdateLoginProvider(
            LoginProvider? provider,
            Revision expectedRevision,
            ProviderDisplayName displayName,
            ConfigurationId configurationId,
            ConfigurationVersionId configurationVersionId,
            SecretId secretId,
            SecretVersionId secretVersionId,
            AuditContext audit,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (provider is null)
        {
            throw new IdentityNotFoundException();
        }

        if (provider.State == LoginProviderState.Deleted)
        {
            throw new IdentityPreconditionException();
        }

        if (provider.Revision != expectedRevision)
        {
            throw new IdentityRevisionConflictException();
        }

        if (provider.DisplayName == displayName
            && provider.ConfigurationId == configurationId
            && provider.ConfigurationVersionId == configurationVersionId
            && provider.SecretId == secretId
            && provider.SecretVersionId == secretVersionId)
        {
            return ValueTask.FromResult(
                new IdentityMutation<LoginProvider>(provider, null));
        }

        provider.Update(
            displayName,
            configurationId,
            configurationVersionId,
            secretId,
            secretVersionId);
        return ValueTask.FromResult(
            new IdentityMutation<LoginProvider>(
                provider,
                new LoginProviderAuditIntent(
                    AuditEventId.Generate(),
                    audit.Attribution,
                    provider.TenantId,
                    provider.ProviderId,
                    provider.Revision,
                    provider.State,
                    LoginProviderAuditAction.Updated,
                    audit.Correlation,
                    audit.OccurredAt)));
    }
}
