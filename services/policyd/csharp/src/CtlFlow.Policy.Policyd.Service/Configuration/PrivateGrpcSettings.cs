namespace CtlFlow.Policy.Policyd.Service.Configuration;

internal sealed record PrivateGrpcSettings(
    Uri Endpoint,
    string ServerName,
    string CertificateAuthorityPath);
