namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal sealed record PrivateGrpcSettings(
    Uri Endpoint,
    string ServerName,
    string CertificateAuthorityPath);
