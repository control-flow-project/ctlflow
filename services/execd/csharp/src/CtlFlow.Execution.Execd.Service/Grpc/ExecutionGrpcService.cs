using CtlFlow.Audit.V1;
using CtlFlow.Configuration.V1;
using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.Execd.Service.Security;
using CtlFlow.Execution.Execd.Service.Security.Invocations;
using CtlFlow.Execution.Execd.Service.Security.Tokens;
using CtlFlow.Execution.Execd.Service.Security.Workloads;
using CtlFlow.Execution.Execd.Service.Telemetry;
using CtlFlow.Execution.V1;
using CtlFlow.Identity.V1;
using CtlFlow.Packages.V1;
using CtlFlow.Policy.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Security.Operators.OperatorAuthentication;
using static CtlFlow.Execution.Execd.Service.Security.Workloads.WorkloadAuthentication;

namespace CtlFlow.Execution.Execd.Service.Grpc;

internal sealed partial class ExecutionGrpcService(
    ExecutionDatabase database,
    ServiceSettings settings,
    TokenAuthorities tokenAuthorities,
    AuditService.AuditServiceClient auditClient,
    PolicyService.PolicyServiceClient policyClient,
    PackageService.PackageServiceClient packageClient,
    ConfigurationService.ConfigurationServiceClient configurationClient,
    IdentityService.IdentityServiceClient identityClient,
    ExecdTelemetry telemetry)
    : ExecutionService.ExecutionServiceBase
{
    private static readonly IReadOnlySet<
        KubernetesServiceAccountSubject> NoAutonomousCallers =
        new HashSet<KubernetesServiceAccountSubject>();
    private readonly AuditService.AuditServiceClient _auditClient =
        auditClient;
    private readonly ConfigurationService.ConfigurationServiceClient
        _configurationClient = configurationClient;
    private readonly ExecutionDatabase _database = database;
    private readonly IdentityService.IdentityServiceClient _identityClient =
        identityClient;
    private readonly PackageService.PackageServiceClient _packageClient =
        packageClient;
    private readonly PolicyService.PolicyServiceClient _policyClient =
        policyClient;
    private readonly ServiceSettings _settings = settings;
    private readonly ExecdTelemetry _telemetry = telemetry;
    private readonly TokenAuthorities _tokenAuthorities = tokenAuthorities;

    private ValueTask<ExecutionRequestIdentity> AuthenticateRequest(
        ServerCallContext context) =>
        context.GetHttpContext().Connection.ClientCertificate is not null
            ? AuthenticateOperatorRequest(
                context,
                _settings.OperatorSubjects)
            : AuthenticateWorkloadRequest(
                context.RequestHeaders,
                _tokenAuthorities,
                NoAutonomousCallers,
                _settings.CapabilityCallers,
                DateTimeOffset.UtcNow,
                context.CancellationToken);
}
