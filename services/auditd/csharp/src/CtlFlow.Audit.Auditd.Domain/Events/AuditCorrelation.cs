using static CtlFlow.Audit.Auditd.Domain.Validation.AuditValidation;

namespace CtlFlow.Audit.Auditd.Domain.Events;

public sealed record AuditCorrelation
{
    private AuditCorrelation(string traceId, string spanId)
    {
        TraceId = traceId;
        SpanId = spanId;
    }

    public string TraceId { get; }

    public string SpanId { get; }

    public static ValueTask<AuditCorrelation> Parse(
        string traceId,
        string spanId,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateTraceId(traceId);
        ValidateSpanId(spanId);
        return ValueTask.FromResult(
            new AuditCorrelation(traceId, spanId));
    }

    public static AuditCorrelation FromStorage(
        string traceId,
        string spanId)
    {
        try
        {
            ValidateTraceId(traceId);
            ValidateSpanId(spanId);
            return new AuditCorrelation(traceId, spanId);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                "Stored audit correlation is invalid",
                exception);
        }
    }
}
