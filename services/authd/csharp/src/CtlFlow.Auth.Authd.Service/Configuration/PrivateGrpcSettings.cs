namespace CtlFlow.Auth.Authd.Service.Configuration;

internal sealed record PrivateGrpcSettings(
    Uri Endpoint,
    string ServerName,
    string CertificateAuthorityPath);
