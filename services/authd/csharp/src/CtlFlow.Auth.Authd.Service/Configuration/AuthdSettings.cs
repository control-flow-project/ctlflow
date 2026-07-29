using CtlFlow.Auth.Authd.Service.Telemetry;

namespace CtlFlow.Auth.Authd.Service.Configuration;

internal sealed record AuthdSettings(
    ListenSettings Public,
    ListenSettings Probe,
    ProviderProjection Projection,
    IdentitySettings Identity,
    WorkloadSettings Workload,
    TelemetrySettings Telemetry);
