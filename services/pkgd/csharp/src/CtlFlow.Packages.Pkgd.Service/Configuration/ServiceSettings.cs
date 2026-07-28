using System.Net;
using CtlFlow.Packages.Pkgd.Db.Providers;
using CtlFlow.Packages.Pkgd.Service.Security.Operators;
using CtlFlow.Packages.Pkgd.Service.Security.Tokens;
using CtlFlow.Packages.Pkgd.Service.Security.Workloads;
using CtlFlow.Packages.Pkgd.Service.Telemetry;

namespace CtlFlow.Packages.Pkgd.Service.Configuration;

internal sealed record ServiceSettings(
    IPAddress GrpcAddress,
    int GrpcPort,
    IPAddress ProbeAddress,
    int ProbePort,
    TlsSettings Tls,
    DatabaseConfiguration Database,
    AuditSettings Audit,
    IdentitySettings Identity,
    PolicySettings Policy,
    WorkloadTokenSettings WorkloadTokens,
    TokenValidationSettings InvocationTokens,
    IReadOnlySet<KubernetesOperatorSubject> OperatorSubjects,
    OperationCallerSettings GetPackageCallers,
    OperationCallerSettings CreateAppCallers,
    OperationCallerSettings GetAppCallers,
    OperationCallerSettings SetAppPackageGenerationCallers,
    TelemetrySettings Telemetry);
