namespace CtlFlow.Execution.Execd.Service.Configuration;

internal sealed record KubernetesSettings(
    Uri Endpoint,
    string CertificateAuthorityPath,
    string TokenFilePath,
    TimeSpan CallTimeout,
    TimeSpan ReconcileInterval,
    EdgedSettings Edged,
    ProductBootstrapSettings Bootstrap);
