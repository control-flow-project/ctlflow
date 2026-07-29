namespace CtlFlow.Execution.Execd.Service.Configuration;

internal sealed record TlsSettings(
    string CertificatePath,
    string PrivateKeyPath,
    string KubernetesClientCertificateAuthorityPath);
