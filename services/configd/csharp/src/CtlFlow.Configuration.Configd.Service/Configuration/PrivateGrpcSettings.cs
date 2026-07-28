namespace CtlFlow.Configuration.Configd.Service.Configuration;

internal sealed record PrivateGrpcSettings(
    Uri Endpoint,
    string ServerName,
    string CertificateAuthorityPath);
