namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal sealed record ProxySettings(
    Uri Origin,
    string CertificateAuthorityPath,
    TimeSpan UpstreamTimeout,
    int MaximumConcurrency);
