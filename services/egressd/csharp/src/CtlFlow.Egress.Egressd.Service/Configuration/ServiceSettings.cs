using CtlFlow.Egress.Egressd.Service.Security.Tokens;
using CtlFlow.Egress.Egressd.Service.Telemetry;

namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal sealed record ServiceSettings(
    ListenSettings Private,
    ListenSettings Probe,
    BoundConfiguration Configuration,
    TokenValidationSettings WorkloadTokens,
    VerificationKeys WorkloadVerificationKeys,
    ProxySettings Proxy,
    TelemetrySettings Telemetry) : IAsyncDisposable
{
    public async ValueTask DisposeAsync() =>
        await WorkloadVerificationKeys.DisposeAsync();
}
