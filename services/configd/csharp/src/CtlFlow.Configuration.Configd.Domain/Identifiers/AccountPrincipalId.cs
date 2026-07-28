namespace CtlFlow.Configuration.Configd.Domain.Identifiers;

public sealed record AccountPrincipalId
{
    private const int MaximumLength = 256;

    private AccountPrincipalId(string value) => Value = value;

    public string Value { get; }

    public static AccountPrincipalId Parse(string value) =>
        new(Validate(value, stored: false));

    public static AccountPrincipalId FromStorage(string value) =>
        new(Validate(value, stored: true));

    private static string Validate(string value, bool stored)
    {
        var separator = value.IndexOf(':');
        var valid = value.Length is >= 3 and <= MaximumLength
            && separator > 0
            && separator < value.Length - 1
            && value.AsSpan(0, separator) is "user" or "service"
            && IsPrincipalIdentifier(value.AsSpan(separator + 1));
        if (!valid)
        {
            if (stored)
            {
                throw new InvalidOperationException(
                    "Stored account principal ID is not canonical");
            }

            throw new ArgumentException(
                "Account principal ID is not canonical",
                nameof(value));
        }

        return value;
    }

    private static bool IsPrincipalIdentifier(ReadOnlySpan<char> value)
    {
        if (value.IsEmpty || !IsLowerAlphaNumeric(value[0]))
        {
            return false;
        }

        foreach (var character in value[1..])
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
