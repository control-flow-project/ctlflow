namespace CtlFlow.Audit.Auditd.Service.Configuration;

internal sealed record TlsSettings(
    string CertificatePath,
    string PrivateKeyPath);
