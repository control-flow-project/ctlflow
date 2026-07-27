using CtlFlow.Audit.Auditd.Db.Providers;
using CtlFlow.Audit.Auditd.Service.Configuration;
using CtlFlow.Audit.Auditd.Service.Security.Tokens;
using CtlFlow.Audit.Auditd.Service.Telemetry;
using CtlFlow.Audit.V1;

namespace CtlFlow.Audit.Auditd.Service.Grpc;

internal sealed partial class AuditGrpcService(
    AuditDatabase auditDatabase,
    ServiceSettings settings,
    VerificationKeys verificationKeys,
    AuditdTelemetry telemetry)
    : AuditService.AuditServiceBase
{
    private readonly AuditDatabase _auditDatabase = auditDatabase;
    private readonly ServiceSettings _settings = settings;
    private readonly AuditdTelemetry _telemetry = telemetry;
    private readonly VerificationKeys _verificationKeys = verificationKeys;
}
