using System.Net;
using CtlFlow.Policy.Policyd.Db.Providers;
using CtlFlow.Policy.Policyd.Service.Security.Tokens;
using CtlFlow.Policy.Policyd.Service.Telemetry;

namespace CtlFlow.Policy.Policyd.Service.Configuration;

internal sealed record ServiceSettings(
    IPAddress GrpcAddress,
    int GrpcPort,
    IPAddress ProbeAddress,
    int ProbePort,
    TlsSettings Tls,
    DatabaseConfiguration Database,
    IdentitySettings Identity,
    WorkloadTokenSettings WorkloadTokens,
    TokenValidationSettings InvocationTokens,
    OwnerCallerSettings OwnerCallers,
    ExecutionSettings Execution,
    string CatalogPath,
    TelemetrySettings Telemetry);
