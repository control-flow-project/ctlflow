namespace CtlFlow.Tenancy.Tenantd.Domain.Addresses;

public sealed record TenantPathPrefix
{
    private const string SharedTenantPrefix = "/tenants/";
    private const int MaximumAddressLength = 63;

    private TenantPathPrefix(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<TenantPathPrefix> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();

        if (!IsCanonical(value))
        {
            throw new ArgumentException("Tenant path prefix is not canonical", nameof(value));
        }

        return ValueTask.FromResult(new TenantPathPrefix(value));
    }

    public static TenantPathPrefix FromStorage(string value)
    {
        if (!IsCanonical(value))
        {
            throw new InvalidOperationException("Stored Tenant path prefix is not canonical");
        }

        return new TenantPathPrefix(value);
    }

    public override string ToString() => Value;

    private static bool IsCanonical(string value)
    {
        if (value == "/")
        {
            return true;
        }

        if (!value.StartsWith(SharedTenantPrefix, StringComparison.Ordinal))
        {
            return false;
        }

        var address = value.AsSpan(SharedTenantPrefix.Length);
        if (address.Length is < 1 or > MaximumAddressLength
            || !IsLowerAlphaNumeric(address[0]))
        {
            return false;
        }

        foreach (var character in address[1..])
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '-' and not '.' and not '_' and not '~')
            {
                return false;
            }
        }

        return !address.SequenceEqual(".") && !address.SequenceEqual("..");
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
