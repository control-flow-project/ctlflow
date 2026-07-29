namespace CtlFlow.Egress.Egressd.Domain.Identifiers;

internal static partial class Identifiers
{
    internal static string ValidateIdentifier(string value, string name)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length is < 1 or > 64
            || !IsLowerAlphaNumeric(value[0]))
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        foreach (var character in value.AsSpan(1))
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '_' and not '-')
            {
                throw new ArgumentException($"{name} is invalid", name);
            }
        }

        return value;
    }

    internal static string ValidateDnsLabel(string value, string name)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length is < 1 or > 63
            || !IsLowerAlphaNumeric(value[0])
            || !IsLowerAlphaNumeric(value[^1]))
        {
            throw new ArgumentException($"{name} is invalid", name);
        }

        for (var index = 1; index < value.Length - 1; index++)
        {
            var character = value[index];
            if (!IsLowerAlphaNumeric(character) && character != '-')
            {
                throw new ArgumentException($"{name} is invalid", name);
            }
        }

        return value;
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
