using CtlFlow.Edge.Edged.Domain.Bindings;
using CtlFlow.Edge.Edged.Service.Telemetry;

namespace CtlFlow.Edge.Edged.Service.Configuration;

internal sealed record ServiceSettings(
    ListenSettings Public,
    ListenSettings Probe,
    EdgedBinding Binding,
    IdentitySettings Identity,
    ProxySettings Proxy,
    TelemetrySettings Telemetry);
