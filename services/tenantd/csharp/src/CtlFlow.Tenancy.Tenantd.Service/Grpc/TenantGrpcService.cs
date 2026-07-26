using CtlFlow.Audit.V1;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;
using CtlFlow.Tenancy.Tenantd.Service.Security;
using CtlFlow.Tenancy.Tenantd.Service.Security.Workloads;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Security.Operators.OperatorAuthentication;
using static CtlFlow.Tenancy.Tenantd.Service.Security.Workloads.WorkloadAuthentication;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService(
    TenantDatabase tenantDatabase,
    ServiceSettings settings,
    TokenAuthorities tokenAuthorities,
    AuditService.AuditServiceClient auditClient,
    TenantdTelemetry telemetry)
    : TenantService.TenantServiceBase
{
    private readonly AuditService.AuditServiceClient _auditClient = auditClient;
    private readonly TenantDatabase _tenantDatabase = tenantDatabase;
    private readonly ServiceSettings _settings = settings;
    private readonly TenantdTelemetry _telemetry = telemetry;
    private readonly TokenAuthorities _tokenAuthorities = tokenAuthorities;

    private async ValueTask<TenantRequestIdentity> AuthenticateAdministration(
        ServerCallContext context)
    {
        return await AuthenticateOperatorRequest(
            context,
            _settings.OperatorSubjects);
    }

    private ValueTask<TenantRequestIdentity> AuthenticateTenantLookup(
        ServerCallContext context) =>
        AuthenticateOperatorOrWorkload(
            context,
            _settings.GetTenantCallers);

    private ValueTask<TenantRequestIdentity> AuthenticateWorkspaceLookup(
        ServerCallContext context) =>
        AuthenticateOperatorOrWorkload(
            context,
            _settings.GetWorkspaceCallers);

    private ValueTask<TenantRequestIdentity> AuthenticateTenantResolution(
        ServerCallContext context) =>
        AuthenticateOperatorOrWorkload(
            context,
            _settings.ResolveTenantCallers);

    private ValueTask<TenantRequestIdentity> AuthenticateWorkspaceResolution(
        ServerCallContext context) =>
        AuthenticateOperatorOrWorkload(
            context,
            _settings.ResolveWorkspaceCallers);

    private ValueTask<TenantRequestIdentity> AuthenticateOperatorOrWorkload(
        ServerCallContext context,
        IReadOnlySet<KubernetesServiceAccountSubject> allowedWorkloads)
    {
        return context.GetHttpContext().Connection.ClientCertificate is not null
            ? AuthenticateOperatorRequest(context, _settings.OperatorSubjects)
            : AuthenticateWorkloadRequest(
                context.RequestHeaders,
                _tokenAuthorities,
                allowedWorkloads,
                DateTimeOffset.UtcNow,
                context.CancellationToken);
    }
}
