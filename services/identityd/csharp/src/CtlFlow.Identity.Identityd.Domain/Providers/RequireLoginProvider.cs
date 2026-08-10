using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Tenants;

namespace CtlFlow.Identity.Identityd.Domain.Providers;

public static partial class LoginProviders
{
    public static ValueTask<LoginProvider> RequireLoginProvider(
        LoginProvider? provider,
        TenantId tenantId,
        ProviderId providerId,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (provider is null
            || provider.TenantId != tenantId
            || provider.ProviderId != providerId
            || provider.State == LoginProviderState.Deleted)
        {
            throw new IdentityNotFoundException();
        }

        return ValueTask.FromResult(provider);
    }
}
