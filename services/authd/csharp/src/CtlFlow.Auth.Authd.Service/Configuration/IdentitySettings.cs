namespace CtlFlow.Auth.Authd.Service.Configuration;

internal sealed record IdentitySettings(
    Uri Endpoint,
    string ServerName,
    string CertificateAuthorityPath);
