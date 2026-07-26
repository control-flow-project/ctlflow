using CtlFlow.Identity.Identityd.Domain.Time;

namespace CtlFlow.Identity.Identityd.Domain.Auditing;

public sealed record AuditContext(
    AuditCaller Caller,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt);
