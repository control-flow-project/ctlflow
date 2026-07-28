using CtlFlow.Configuration.Configd.Domain.Time;

namespace CtlFlow.Configuration.Configd.Domain.Auditing;

public sealed record AuditContext(
    AuditAttribution Attribution,
    AuditTraceId TraceId,
    AuditSpanId SpanId,
    UtcInstant OccurredAt);
