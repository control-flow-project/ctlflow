using CtlFlow.Auth.Authd.Domain.Identifiers;

namespace CtlFlow.Auth.Authd.Service.Configuration;

internal sealed class ProviderProjection(
    Uri publicOrigin,
    IReadOnlyDictionary<string, ProviderRegistration> providers)
{
    internal Uri PublicOrigin { get; } = publicOrigin;

    internal Uri CallbackUri { get; } = new(
        $"{publicOrigin.AbsoluteUri.TrimEnd('/')}/auth/v1/callback",
        UriKind.Absolute);

    internal ProviderRegistration? Find(
        TenantId tenantId,
        ProviderId providerId) =>
        providers.GetValueOrDefault(
            CreateKey(tenantId.Value, providerId.Value));

    internal static string CreateKey(string tenantId, string providerId) =>
        $"{tenantId}\0{providerId}";
}
