using CtlFlow.Audit.V1;
using CtlFlow.Packages.Pkgd.Db.Providers;
using CtlFlow.Packages.Pkgd.Service.Configuration;
using CtlFlow.Packages.Pkgd.Service.Security;
using CtlFlow.Packages.Pkgd.Service.Security.Invocations;
using CtlFlow.Packages.Pkgd.Service.Security.Tokens;
using CtlFlow.Packages.Pkgd.Service.Telemetry;
using CtlFlow.Packages.V1;
using CtlFlow.Policy.V1;
using Grpc.Core;
using static CtlFlow.Packages.Pkgd.Service.Security.Operators.OperatorAuthentication;
using static CtlFlow.Packages.Pkgd.Service.Security.Workloads.WorkloadAuthentication;

namespace CtlFlow.Packages.Pkgd.Service.Grpc;

internal sealed partial class PackageGrpcService(
    PackageDatabase packageDatabase,
    ServiceSettings settings,
    TokenAuthorities tokenAuthorities,
    AuditService.AuditServiceClient auditClient,
    PolicyService.PolicyServiceClient policyClient,
    PkgdTelemetry telemetry)
    : PackageService.PackageServiceBase
{
    private readonly AuditService.AuditServiceClient _auditClient = auditClient;
    private readonly PackageDatabase _packageDatabase = packageDatabase;
    private readonly PolicyService.PolicyServiceClient _policyClient =
        policyClient;
    private readonly ServiceSettings _settings = settings;
    private readonly PkgdTelemetry _telemetry = telemetry;
    private readonly TokenAuthorities _tokenAuthorities = tokenAuthorities;

    private ValueTask<PackageRequestIdentity> AuthenticateDeclaration(
        ServerCallContext context) =>
        AuthenticateOperatorRequest(context, _settings.OperatorSubjects);

    private ValueTask<PackageRequestIdentity> AuthenticatePackageLookup(
        ServerCallContext context) =>
        AuthenticateOperatorOrWorkload(
            context,
            _settings.GetPackageCallers);

    private ValueTask<PackageRequestIdentity> AuthenticateAppCreation(
        ServerCallContext context) =>
        AuthenticateOperatorOrWorkload(
            context,
            _settings.CreateAppCallers);

    private ValueTask<PackageRequestIdentity> AuthenticateAppLookup(
        ServerCallContext context) =>
        AuthenticateOperatorOrWorkload(
            context,
            _settings.GetAppCallers);

    private ValueTask<PackageRequestIdentity> AuthenticateAppMutation(
        ServerCallContext context) =>
        AuthenticateOperatorOrWorkload(
            context,
            _settings.SetAppPackageGenerationCallers);

    private ValueTask<PackageRequestIdentity> AuthenticateOperatorOrWorkload(
        ServerCallContext context,
        OperationCallerSettings callers) =>
        context.GetHttpContext().Connection.ClientCertificate is not null
            ? AuthenticateOperatorRequest(
                context,
                _settings.OperatorSubjects)
            : AuthenticateWorkloadRequest(
                context.RequestHeaders,
                _tokenAuthorities,
                callers.AutonomousCallers,
                callers.CapabilityCallers,
                DateTimeOffset.UtcNow,
                context.CancellationToken);
}
