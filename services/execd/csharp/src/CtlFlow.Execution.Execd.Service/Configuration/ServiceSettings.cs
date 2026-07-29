using System.Net;
using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Service.Security.Operators;
using CtlFlow.Execution.Execd.Service.Security.Tokens;
using CtlFlow.Execution.Execd.Service.Security.Workloads;
using CtlFlow.Execution.Execd.Service.Telemetry;

namespace CtlFlow.Execution.Execd.Service.Configuration;

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
    PackageSettings Package,
    ConfigurationSettings Configuration,
    KubernetesSettings Kubernetes,
    ProvisionerSettings Provisioners,
    WorkloadTokenSettings WorkloadTokens,
    TokenValidationSettings InvocationTokens,
    IReadOnlySet<KubernetesOperatorSubject> OperatorSubjects,
    IReadOnlySet<KubernetesServiceAccountSubject> CapabilityCallers,
    TelemetrySettings Telemetry);
