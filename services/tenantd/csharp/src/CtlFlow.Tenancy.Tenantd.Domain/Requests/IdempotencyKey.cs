namespace CtlFlow.Tenancy.Tenantd.Domain.Requests;

public sealed record IdempotencyKey
{
    private const int MaximumLength = 128;

    private IdempotencyKey(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<IdempotencyKey> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!IsCanonical(value))
        {
            throw new ArgumentException(
                "Idempotency key is not canonical",
                nameof(value));
        }

        return ValueTask.FromResult(new IdempotencyKey(value));
    }

    public static IdempotencyKey FromStorage(string value)
    {
        if (!IsCanonical(value))
        {
            throw new InvalidOperationException(
                "Stored idempotency key is not canonical");
        }

        return new IdempotencyKey(value);
    }

    public override string ToString() => Value;

    private static bool IsCanonical(string value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > MaximumLength)
        {
            return false;
        }

        foreach (var character in value)
        {
            if (character is not (
                >= 'A' and <= 'Z'
                or >= 'a' and <= 'z'
                or >= '0' and <= '9'
                or '.'
                or '_'
                or ':'
                or '-'))
            {
                return false;
            }
        }

        return true;
    }
}
