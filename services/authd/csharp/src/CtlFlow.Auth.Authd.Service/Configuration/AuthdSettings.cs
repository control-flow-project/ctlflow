using CtlFlow.Auth.Authd.Service.Telemetry;

namespace CtlFlow.Auth.Authd.Service.Configuration;

internal sealed record AuthdSettings(
    ListenSettings Public,
    ListenSettings Probe,
    ProviderProjection Projection,
    PrivateGrpcSettings Identity,
    PrivateGrpcSettings Tenant,
    WorkloadSettings Workload,
    TelemetrySettings Telemetry);
