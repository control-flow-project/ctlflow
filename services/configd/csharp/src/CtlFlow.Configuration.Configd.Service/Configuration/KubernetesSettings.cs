namespace CtlFlow.Configuration.Configd.Service.Configuration;

internal sealed record KubernetesSettings(
    Uri Endpoint,
    string CertificateAuthorityPath,
    string TokenFilePath,
    TimeSpan CallTimeout);
