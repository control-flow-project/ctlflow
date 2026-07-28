using CtlFlow.Audit.V1;
using CtlFlow.Configuration.Configd.Db.Custody;
using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Service.Configuration;
using CtlFlow.Configuration.Configd.Service.Kubernetes;
using CtlFlow.Configuration.Configd.Service.Security;
using CtlFlow.Configuration.Configd.Service.Security.Invocations;
using CtlFlow.Configuration.Configd.Service.Security.Tokens;
using CtlFlow.Configuration.Configd.Service.Telemetry;
using CtlFlow.Configuration.V1;
using CtlFlow.Policy.V1;
using Grpc.Core;
using static CtlFlow.Configuration.Configd.Service.Security.Operators.OperatorAuthentication;
using static CtlFlow.Configuration.Configd.Service.Security.Workloads.WorkloadAuthentication;

namespace CtlFlow.Configuration.Configd.Service.Grpc;

internal sealed partial class ConfigurationGrpcService(
    ConfigurationDatabase configurationDatabase,
    EncryptionKeyRing encryptionKeys,
    KubernetesApi kubernetes,
    ServiceSettings settings,
    TokenAuthorities tokenAuthorities,
    AuditService.AuditServiceClient auditClient,
    PolicyService.PolicyServiceClient policyClient,
    ConfigdTelemetry telemetry)
    : ConfigurationService.ConfigurationServiceBase
{
    private readonly AuditService.AuditServiceClient _auditClient =
        auditClient;
    private readonly ConfigurationDatabase _configurationDatabase =
        configurationDatabase;
    private readonly EncryptionKeyRing _encryptionKeys = encryptionKeys;
    private readonly KubernetesApi _kubernetes = kubernetes;
    private readonly PolicyService.PolicyServiceClient _policyClient =
        policyClient;
    private readonly ServiceSettings _settings = settings;
    private readonly ConfigdTelemetry _telemetry = telemetry;
    private readonly TokenAuthorities _tokenAuthorities = tokenAuthorities;

    private ValueTask<ConfigRequestIdentity>
        AuthenticatePublishConfiguration(ServerCallContext context) =>
        AuthenticateOperatorOrWorkload(
            context,
            _settings.PublishConfigurationCallers,
            ConfigAdmission.Provisioner);

    private ValueTask<ConfigRequestIdentity>
        AuthenticateResolveConfiguration(ServerCallContext context) =>
        AuthenticateOperatorOrWorkload(
            context,
            _settings.ResolveConfigurationCallers,
            ConfigAdmission.Provisioner);

    private ValueTask<ConfigRequestIdentity> AuthenticatePublishSecret(
        ServerCallContext context) =>
        AuthenticateOperatorOrWorkload(
            context,
            _settings.PublishSecretCallers,
            ConfigAdmission.Provisioner);

    private ValueTask<ConfigRequestIdentity> AuthenticateGetSecretMetadata(
        ServerCallContext context) =>
        AuthenticateOperatorOrWorkload(
            context,
            _settings.GetSecretMetadataCallers,
            ConfigAdmission.Provisioner);

    private ValueTask<ConfigRequestIdentity> AuthenticateApplyProjection(
        ServerCallContext context) =>
        AuthenticateOperatorOrWorkload(
            context,
            _settings.ApplyProjectionCallers,
            ConfigAdmission.Execd,
            admitOperator: false);

    private ValueTask<ConfigRequestIdentity> AuthenticateOperatorOrWorkload(
        ServerCallContext context,
        OperationCallerSettings callers,
        ConfigAdmission autonomousAdmission,
        bool admitOperator = true)
    {
        var hasCertificate =
            context.GetHttpContext().Connection.ClientCertificate is not null;
        if (hasCertificate)
        {
            return admitOperator
                ? AuthenticateOperatorRequest(
                    context,
                    _settings.OperatorSubjects)
                : ValueTask.FromException<ConfigRequestIdentity>(
                    new CallerNotAdmittedException());
        }

        return AuthenticateWorkloadRequest(
            context.RequestHeaders,
            _tokenAuthorities,
            callers.AutonomousCallers,
            callers.CapabilityCallers,
            autonomousAdmission,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
    }
}
