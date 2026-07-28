namespace CtlFlow.Configuration.Configd.Domain.Auditing;

public sealed record AuditTraceId
{
    private AuditTraceId(string value) => Value = value;

    public string Value { get; }

    public static AuditTraceId Parse(string value) =>
        IsLowerHex(value, 32)
            ? new AuditTraceId(value)
            : throw new ArgumentException("Trace ID is invalid", nameof(value));

    public static AuditTraceId FromStorage(string value) =>
        IsLowerHex(value, 32)
            ? new AuditTraceId(value)
            : throw new InvalidOperationException("Stored trace ID is invalid");

    private static bool IsLowerHex(string value, int length) =>
        value.Length == length
        && value.AsSpan().IndexOfAnyExcept(
            "0123456789abcdef".AsSpan()) < 0
        && value.AsSpan().IndexOfAnyExcept('0') >= 0;
}
