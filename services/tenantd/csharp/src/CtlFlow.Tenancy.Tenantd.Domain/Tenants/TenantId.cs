namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public sealed record TenantId
{
    private const int MaximumLength = 64;

    private TenantId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<TenantId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();

        if (!IsCanonical(value))
        {
            throw new ArgumentException("Tenant ID is not canonical", nameof(value));
        }

        return ValueTask.FromResult(new TenantId(value));
    }

    public static TenantId FromStorage(string value)
    {
        if (!IsCanonical(value))
        {
            throw new InvalidOperationException("Stored Tenant ID is not canonical");
        }

        return new TenantId(value);
    }

    public override string ToString() => Value;

    private static bool IsCanonical(string value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > MaximumLength)
        {
            return false;
        }

        if (!IsLowerAlphaNumeric(value[0]))
        {
            return false;
        }

        for (var index = 1; index < value.Length; index++)
        {
            var character = value[index];
            if (!IsLowerAlphaNumeric(character) && character is not '_' and not '-')
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
