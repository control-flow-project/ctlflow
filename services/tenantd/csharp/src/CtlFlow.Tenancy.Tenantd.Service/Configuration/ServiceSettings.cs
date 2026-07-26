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
    PolicySettings Policy,
    WorkloadTokenSettings WorkloadTokens,
    TokenValidationSettings InvocationTokens,
    IReadOnlySet<KubernetesOperatorSubject> OperatorSubjects,
    OperationCallerSettings GetTenantCallers,
    OperationCallerSettings UpdateTenantCallers,
    OperationCallerSettings CreateWorkspaceCallers,
    OperationCallerSettings GetWorkspaceCallers,
    OperationCallerSettings ListWorkspaceCallers,
    OperationCallerSettings UpdateWorkspaceCallers,
    OperationCallerSettings SetWorkspaceStateCallers,
    OperationCallerSettings ResolveTenantCallers,
    OperationCallerSettings ResolveWorkspaceCallers,
    TelemetrySettings Telemetry);
