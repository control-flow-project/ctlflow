using CtlFlow.Identity.Identityd.Domain.Auditing;
using static CtlFlow.Identity.Identityd.Service.Auditing.AuditDelivery;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    private Task RecordAdministrationAudit(
        IdentityAdministrationAuditIntent? intent,
        CancellationToken cancellation) =>
        intent is null
            ? Task.CompletedTask
            : RecordAudit(
                _auditClient,
                _settings.Audit,
                _telemetry,
                intent,
                cancellation);
}
