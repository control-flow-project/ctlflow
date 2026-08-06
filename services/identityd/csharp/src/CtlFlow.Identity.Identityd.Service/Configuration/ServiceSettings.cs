using System.Net;
using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Sessions;
using CtlFlow.Identity.Identityd.Service.Security.Tokens;
using CtlFlow.Identity.Identityd.Service.Security.Workloads;
using CtlFlow.Identity.Identityd.Service.Telemetry;

namespace CtlFlow.Identity.Identityd.Service.Configuration;

internal sealed record ServiceSettings(
    IPAddress GrpcAddress,
    int GrpcPort,
    IPAddress ProbeAddress,
    int ProbePort,
    TlsSettings Tls,
    DatabaseConfiguration Database,
    AuditSettings Audit,
    WorkloadTokenSettings WorkloadTokens,
    TokenValidationSettings EdgedTokens,
    TokenValidationSettings InvocationTokens,
    SigningSettings Signing,
    SessionLifetime SessionLifetime,
    TimeSpan InvocationKeyCacheLifetime,
    IReadOnlySet<KubernetesServiceAccountSubject>
        ResolvePrincipalCallers,
    IReadOnlySet<KubernetesServiceAccountSubject>
        ListPrincipalGroupsCallers,
    IReadOnlySet<KubernetesServiceAccountSubject>
        CreateSessionCallers,
    IReadOnlySet<KubernetesServiceAccountSubject>
        RevokeSessionCallers,
    IReadOnlySet<KubernetesServiceAccountSubject>
        IssueRunInvocationCallers,
    TelemetrySettings Telemetry);
