namespace CtlFlow.Configuration.Configd.Service.Configuration;

internal sealed record TlsSettings(
    string CertificatePath,
    string PrivateKeyPath,
    string KubernetesClientCertificateAuthorityPath);
