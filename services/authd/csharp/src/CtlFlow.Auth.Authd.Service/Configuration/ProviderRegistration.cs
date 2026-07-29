using CtlFlow.Auth.Authd.Domain.Identifiers;

namespace CtlFlow.Auth.Authd.Service.Configuration;

internal sealed record ProviderRegistration(
    TenantId TenantId,
    ProviderId ProviderId,
    Uri Issuer,
    Uri AuthorizationEndpoint,
    Uri TokenEndpoint,
    Uri UserInfoEndpoint,
    string ClientId,
    string CredentialReference,
    string EgressBinding,
    IReadOnlyDictionary<string, OidcVerificationKey> VerificationKeys,
    ClientSecret ClientSecret)
{
    internal Uri EgressOrigin { get; } =
        new($"http://{EgressBinding}:8081/", UriKind.Absolute);
}
