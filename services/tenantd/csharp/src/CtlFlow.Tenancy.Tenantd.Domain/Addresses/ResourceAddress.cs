namespace CtlFlow.Tenancy.Tenantd.Domain.Addresses;

public sealed record ResourceAddress
{
    private ResourceAddress(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ResourceAddress> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!IsCanonical(value))
        {
            throw new ArgumentException("Address is not canonical", nameof(value));
        }

        return ValueTask.FromResult(new ResourceAddress(value));
    }

    public static ResourceAddress FromStorage(string value)
    {
        if (!IsCanonical(value))
        {
            throw new InvalidOperationException("Stored address is not canonical");
        }

        return new ResourceAddress(value);
    }

    public override string ToString() => Value;

    private static bool IsCanonical(string value)
    {
        if (string.IsNullOrEmpty(value)
            || value.Length > 63
            || value is "." or "..")
        {
            return false;
        }

        foreach (var character in value)
        {
            if (character is not (>= 'a' and <= 'z')
                and not (>= '0' and <= '9')
                and not '-'
                and not '.'
                and not '_'
                and not '~')
            {
                return false;
            }
        }

        return true;
    }
}
