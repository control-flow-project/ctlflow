namespace CtlFlow.Identity.Identityd.Domain.Runs;

public sealed record RunId
{
    private RunId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static RunId Parse(string value)
    {
        if (!IsCanonical(value))
        {
            throw new ArgumentException("Run ID is invalid", nameof(value));
        }

        return new RunId(value);
    }

    private static bool IsCanonical(string value)
    {
        if (string.IsNullOrEmpty(value)
            || value.Length > 128
            || !IsLowerAlphaNumeric(value[0]))
        {
            return false;
        }

        foreach (var character in value.AsSpan(1))
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '_' and not '-' and not '.')
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
