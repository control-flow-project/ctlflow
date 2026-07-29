using CtlFlow.Execution.Execd.Domain.Time;

namespace CtlFlow.Execution.Execd.Domain.Auditing;

public sealed record AuditContext(
    AuditAttribution Attribution,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt);
