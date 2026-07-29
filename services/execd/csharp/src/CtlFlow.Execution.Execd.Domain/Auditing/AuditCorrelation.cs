namespace CtlFlow.Execution.Execd.Domain.Auditing;

public sealed record AuditCorrelation
{
    public AuditCorrelation(string traceId, string spanId)
    {
        TraceId = ValidateHex(traceId, 32, "trace ID");
        SpanId = ValidateHex(spanId, 16, "span ID");
    }

    public string TraceId { get; }
    public string SpanId { get; }

    private static string ValidateHex(
        string value,
        int length,
        string label)
    {
        if (value.Length != length
            || value.All(character => character == '0')
            || value.Any(character => character is not (
                >= '0' and <= '9') and not (>= 'a' and <= 'f')))
        {
            throw new ArgumentException($"Audit {label} is invalid");
        }

        return value;
    }
}
