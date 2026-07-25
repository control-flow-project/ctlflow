namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditSpanId
{
    private AuditSpanId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<AuditSpanId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!IsLowerHex(value, 16))
        {
            throw new ArgumentException(
                "Audit span ID must be 16 lowercase hexadecimal characters",
                nameof(value));
        }

        return ValueTask.FromResult(new AuditSpanId(value));
    }

    public static AuditSpanId FromStorage(string value) =>
        IsLowerHex(value, 16)
            ? new AuditSpanId(value)
            : throw new InvalidOperationException(
                "Stored audit span ID is invalid");

    private static bool IsLowerHex(string value, int length) =>
        value.Length == length
        && value.All(character =>
            character is >= '0' and <= '9'
                or >= 'a' and <= 'f');
}
