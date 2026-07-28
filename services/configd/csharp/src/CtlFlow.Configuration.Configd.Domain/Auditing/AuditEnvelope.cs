using CtlFlow.Configuration.Configd.Domain.Time;

namespace CtlFlow.Configuration.Configd.Domain.Auditing;

public sealed record AuditEnvelope(
    AuditEventId EventId,
    AuditAttribution Attribution,
    AuditTraceId TraceId,
    AuditSpanId SpanId,
    UtcInstant OccurredAt)
{
    public static AuditEnvelope Create(AuditContext context) =>
        new(
            AuditEventId.Generate(),
            context.Attribution,
            context.TraceId,
            context.SpanId,
            context.OccurredAt);
}
