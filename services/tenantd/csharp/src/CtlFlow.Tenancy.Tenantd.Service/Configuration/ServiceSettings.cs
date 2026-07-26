using System.Net;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using CtlFlow.Tenancy.Tenantd.Service.Security.Operators;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using CtlFlow.Tenancy.Tenantd.Service.Security.Workloads;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;

namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal sealed record ServiceSettings(
    IPAddress GrpcAddress,
    int GrpcPort,
    IPAddress ProbeAddress,
    int ProbePort,
    TlsSettings Tls,
    DatabaseConfiguration Database,
    AuditSettings Audit,
    IdentitySettings Identity,
    WorkloadTokenSettings WorkloadTokens,
    TokenValidationSettings InvocationTokens,
    IReadOnlySet<KubernetesOperatorSubject> OperatorSubjects,
    IReadOnlySet<KubernetesServiceAccountSubject> GetTenantCallers,
    IReadOnlySet<KubernetesServiceAccountSubject> GetWorkspaceCallers,
    IReadOnlySet<KubernetesServiceAccountSubject> ResolveTenantCallers,
    IReadOnlySet<KubernetesServiceAccountSubject> ResolveWorkspaceCallers,
    TelemetrySettings Telemetry);
