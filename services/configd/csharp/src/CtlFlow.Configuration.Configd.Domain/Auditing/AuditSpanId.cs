namespace CtlFlow.Configuration.Configd.Domain.Auditing;

public sealed record AuditSpanId
{
    private AuditSpanId(string value) => Value = value;

    public string Value { get; }

    public static AuditSpanId Parse(string value) =>
        IsLowerHex(value, 16)
            ? new AuditSpanId(value)
            : throw new ArgumentException("Span ID is invalid", nameof(value));

    public static AuditSpanId FromStorage(string value) =>
        IsLowerHex(value, 16)
            ? new AuditSpanId(value)
            : throw new InvalidOperationException("Stored span ID is invalid");

    private static bool IsLowerHex(string value, int length) =>
        value.Length == length
        && value.AsSpan().IndexOfAnyExcept(
            "0123456789abcdef".AsSpan()) < 0
        && value.AsSpan().IndexOfAnyExcept('0') >= 0;
}
