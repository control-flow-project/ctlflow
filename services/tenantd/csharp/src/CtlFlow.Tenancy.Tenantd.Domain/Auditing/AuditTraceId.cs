namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditTraceId
{
    private AuditTraceId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<AuditTraceId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!IsLowerHex(value, 32))
        {
            throw new ArgumentException(
                "Audit trace ID must be 32 lowercase hexadecimal characters",
                nameof(value));
        }

        return ValueTask.FromResult(new AuditTraceId(value));
    }

    public static AuditTraceId FromStorage(string value) =>
        IsLowerHex(value, 32)
            ? new AuditTraceId(value)
            : throw new InvalidOperationException(
                "Stored audit trace ID is invalid");

    private static bool IsLowerHex(string value, int length) =>
        value.Length == length
        && value.All(character =>
            character is >= '0' and <= '9'
                or >= 'a' and <= 'f');
}
