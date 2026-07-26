namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal sealed record TlsSettings(
    string CertificatePath,
    string PrivateKeyPath,
    string KubernetesClientCertificateAuthorityPath);
