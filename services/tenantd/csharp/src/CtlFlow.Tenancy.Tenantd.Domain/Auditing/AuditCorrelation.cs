namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditCorrelation
{
    public AuditCorrelation(string traceId, string spanId)
    {
        if (!IsLowerHex(traceId, 32) || !IsLowerHex(spanId, 16))
        {
            throw new ArgumentException("Audit correlation is invalid");
        }

        TraceId = traceId;
        SpanId = spanId;
    }

    public string TraceId { get; }

    public string SpanId { get; }

    private static bool IsLowerHex(string value, int length)
    {
        if (value.Length != length)
        {
            return false;
        }

        foreach (var character in value)
        {
            if (character is not (>= '0' and <= '9')
                and not (>= 'a' and <= 'f'))
            {
                return false;
            }
        }

        return true;
    }
}
