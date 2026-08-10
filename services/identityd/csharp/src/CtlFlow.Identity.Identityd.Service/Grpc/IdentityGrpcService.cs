using CtlFlow.Audit.V1;
using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.Identityd.Service.Security;
using CtlFlow.Identity.Identityd.Service.Security.Signing;
using CtlFlow.Identity.Identityd.Service.Telemetry;
using CtlFlow.Identity.V1;
using CtlFlow.Policy.V1;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService(
    IdentityDatabase identityDatabase,
    ServiceSettings settings,
    TokenAuthorities tokenAuthorities,
    InvocationSigningKey signingKey,
    AuditService.AuditServiceClient auditClient,
    PolicyService.PolicyServiceClient policyClient,
    IdentitydTelemetry telemetry)
    : IdentityService.IdentityServiceBase
{
    private readonly IdentityDatabase _identityDatabase = identityDatabase;
    private readonly ServiceSettings _settings = settings;
    private readonly TokenAuthorities _tokenAuthorities = tokenAuthorities;
    private readonly InvocationSigningKey _signingKey = signingKey;
    private readonly AuditService.AuditServiceClient _auditClient =
        auditClient;
    private readonly PolicyService.PolicyServiceClient _policyClient =
        policyClient;
    private readonly IdentitydTelemetry _telemetry = telemetry;
}
