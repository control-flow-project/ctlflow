using CtlFlow.Identity.Identityd.Domain.Providers;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal static partial class IdentityResponses
{
    internal static CtlFlow.Identity.V1.LoginProvider
        CreateLoginProviderMessage(LoginProvider provider) => new()
        {
            TenantId = provider.TenantId.Value,
            ProviderId = provider.ProviderId.Value,
            DisplayName = provider.DisplayName.Value,
            ConfigurationId = provider.ConfigurationId.Value,
            ConfigurationVersionId = provider.ConfigurationVersionId.Value,
            SecretId = provider.SecretId.Value,
            SecretVersionId = provider.SecretVersionId.Value,
            State = MapLoginProviderState(provider.State),
            Revision = checked((ulong)provider.Revision.Value)
        };
}
