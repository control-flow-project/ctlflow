using System.Net;
using CtlFlow.Tenancy.Tenantd.Db.Sqlite;
using CtlFlow.Tenancy.Tenantd.Domain.Caching;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using CtlFlow.Tenancy.Tenantd.Service.Security.Workloads;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;

namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal sealed record ServiceSettings(
    IPAddress GrpcAddress,
    int GrpcPort,
    IPAddress ProbeAddress,
    int ProbePort,
    DatabaseFilePath DatabasePath,
    DatabasePoolSize DatabasePoolSize,
    CacheLifetime CacheLifetime,
    TokenValidationSettings WorkloadTokens,
    TokenValidationSettings InvocationTokens,
    IReadOnlySet<KubernetesServiceAccountSubject> ResolveTenantCallers,
    IReadOnlySet<KubernetesServiceAccountSubject> ResolveWorkspaceCallers,
    TelemetrySettings Telemetry);
