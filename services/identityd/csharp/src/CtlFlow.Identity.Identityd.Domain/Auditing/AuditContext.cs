using CtlFlow.Identity.Identityd.Domain.Time;

namespace CtlFlow.Identity.Identityd.Domain.Auditing;

public sealed record AuditContext(
    AuditAttribution Attribution,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt);
