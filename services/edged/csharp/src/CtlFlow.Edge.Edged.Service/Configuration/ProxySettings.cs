namespace CtlFlow.Edge.Edged.Service.Configuration;

internal sealed record ProxySettings(
    Uri ApplicationOrigin,
    TimeSpan ApplicationTimeout,
    int MaximumConcurrency);
