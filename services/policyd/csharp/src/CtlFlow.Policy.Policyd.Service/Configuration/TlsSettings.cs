namespace CtlFlow.Policy.Policyd.Service.Configuration;

internal sealed record TlsSettings(
    string CertificatePath,
    string PrivateKeyPath);
