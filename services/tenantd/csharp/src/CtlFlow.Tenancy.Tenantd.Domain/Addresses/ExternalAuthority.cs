namespace CtlFlow.Tenancy.Tenantd.Domain.Addresses;

public sealed record ExternalAuthority
{
    private const int MaximumLength = 253;

    private ExternalAuthority(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ExternalAuthority> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();

        if (!IsCanonical(value))
        {
            throw new ArgumentException("External authority is not canonical", nameof(value));
        }

        return ValueTask.FromResult(new ExternalAuthority(value));
    }

    public static ExternalAuthority FromStorage(string value)
    {
        if (!IsCanonical(value))
        {
            throw new InvalidOperationException("Stored external authority is not canonical");
        }

        return new ExternalAuthority(value);
    }

    public override string ToString() => Value;

    private static bool IsCanonical(string value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > MaximumLength)
        {
            return false;
        }

        var labelLength = 0;
        var labelStartsWithAlphaNumeric = false;
        var previous = '\0';

        foreach (var character in value)
        {
            if (character == '.')
            {
                if (labelLength == 0 || labelLength > 63 || previous == '-')
                {
                    return false;
                }

                labelLength = 0;
                labelStartsWithAlphaNumeric = false;
                previous = character;
                continue;
            }

            var alphaNumeric = character is >= 'a' and <= 'z' or >= '0' and <= '9';
            if (!alphaNumeric && character != '-')
            {
                return false;
            }

            if (labelLength == 0)
            {
                labelStartsWithAlphaNumeric = alphaNumeric;
            }

            if (!labelStartsWithAlphaNumeric)
            {
                return false;
            }

            labelLength++;
            previous = character;
        }

        return labelLength is > 0 and <= 63 && previous != '-';
    }
}
