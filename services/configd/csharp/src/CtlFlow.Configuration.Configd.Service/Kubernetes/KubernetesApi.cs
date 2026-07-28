using CtlFlow.Configuration.Configd.Service.Configuration;
using CtlFlow.Configuration.Configd.Service.Telemetry;

namespace CtlFlow.Configuration.Configd.Service.Kubernetes;

internal sealed class KubernetesApi(
    HttpClient client,
    KubernetesSettings settings,
    ConfigdTelemetry telemetry) : IDisposable
{
    internal HttpClient Client { get; } = client;

    internal KubernetesSettings Settings { get; } = settings;

    internal ConfigdTelemetry Telemetry { get; } = telemetry;

    public void Dispose() => Client.Dispose();
}
