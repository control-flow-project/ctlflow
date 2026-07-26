namespace CtlFlow.Identity.Identityd.Service.Configuration;

internal sealed record TlsSettings(
    string CertificatePath,
    string PrivateKeyPath);
