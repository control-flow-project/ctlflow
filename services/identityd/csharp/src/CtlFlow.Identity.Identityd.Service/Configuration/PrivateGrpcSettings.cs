namespace CtlFlow.Identity.Identityd.Service.Configuration;

internal sealed record PrivateGrpcSettings(
    Uri Endpoint,
    string ServerName,
    string CertificateAuthorityPath);
