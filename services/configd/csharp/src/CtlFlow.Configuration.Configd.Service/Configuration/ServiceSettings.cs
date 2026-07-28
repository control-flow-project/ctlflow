using System.Net;
using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Service.Security.Operators;
using CtlFlow.Configuration.Configd.Service.Security.Tokens;
using CtlFlow.Configuration.Configd.Service.Telemetry;

namespace CtlFlow.Configuration.Configd.Service.Configuration;

internal sealed record ServiceSettings(
    IPAddress GrpcAddress,
    int GrpcPort,
    IPAddress ProbeAddress,
    int ProbePort,
    TlsSettings Tls,
    DatabaseConfiguration Database,
    string EncryptionKeyRingPath,
    KubernetesSettings Kubernetes,
    AuditSettings Audit,
    IdentitySettings Identity,
    PolicySettings Policy,
    WorkloadTokenSettings WorkloadTokens,
    TokenValidationSettings InvocationTokens,
    IReadOnlySet<KubernetesOperatorSubject> OperatorSubjects,
    OperationCallerSettings PublishConfigurationCallers,
    OperationCallerSettings ResolveConfigurationCallers,
    OperationCallerSettings PublishSecretCallers,
    OperationCallerSettings GetSecretMetadataCallers,
    OperationCallerSettings ApplyProjectionCallers,
    TelemetrySettings Telemetry);
