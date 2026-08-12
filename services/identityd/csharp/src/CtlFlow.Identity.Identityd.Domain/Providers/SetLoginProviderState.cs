using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Resources;

namespace CtlFlow.Identity.Identityd.Domain.Providers;

public static partial class LoginProviders
{
    public static ValueTask<IdentityMutation<LoginProvider>>
        SetLoginProviderState(
            LoginProvider? provider,
            Revision expectedRevision,
            LoginProviderState state,
            AuditContext audit,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (provider is null)
        {
            throw new IdentityNotFoundException();
        }

        if (provider.Revision != expectedRevision)
        {
            throw new IdentityRevisionConflictException();
        }

        if (provider.State == state)
        {
            return ValueTask.FromResult(
                new IdentityMutation<LoginProvider>(provider, null));
        }

        if (provider.State == LoginProviderState.Deleted)
        {
            throw new IdentityPreconditionException();
        }

        provider.SetState(state);
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
                    LoginProviderAuditAction.StateChanged,
                    audit.Correlation,
                    audit.OccurredAt)));
    }
}
