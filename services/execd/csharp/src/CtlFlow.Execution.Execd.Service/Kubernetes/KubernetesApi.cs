using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.Execd.Service.Telemetry;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal sealed class KubernetesApi(
    HttpClient client,
    KubernetesSettings settings,
    ExecdTelemetry telemetry) : IDisposable
{
    internal HttpClient Client { get; } = client;

    internal KubernetesSettings Settings { get; } = settings;

    internal ExecdTelemetry Telemetry { get; } = telemetry;

    public void Dispose() => Client.Dispose();
}
