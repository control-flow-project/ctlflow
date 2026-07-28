namespace CtlFlow.Policy.Policyd.Domain.Identifiers;

internal static partial class Identifiers
{
    internal static string ValidateIdentifier(
        string value,
        int maximumLength,
        bool allowDot,
        string parameterName)
    {
        ArgumentNullException.ThrowIfNull(value, parameterName);
        if (value.Length is < 1 || value.Length > maximumLength
            || !IsLowerAlphaNumeric(value[0]))
        {
            throw new ArgumentException(
                "Identifier is not canonical",
                parameterName);
        }

        foreach (var character in value.AsSpan(1))
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '_' and not '-'
                && (!allowDot || character != '.'))
            {
                throw new ArgumentException(
                    "Identifier is not canonical",
                    parameterName);
            }
        }

        return value;
    }

    internal static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
