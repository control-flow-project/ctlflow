namespace CtlFlow.Packages.Pkgd.Domain.Identifiers;

internal static partial class Identifiers
{
    internal static string ValidateDeclarationId(
        string value,
        int maximumLength,
        bool allowDot,
        string label,
        bool stored)
    {
        if (string.IsNullOrEmpty(value)
            || value.Length > maximumLength
            || !IsLowerAlphaNumeric(value[0]))
        {
            throw CreateException(label, stored);
        }

        foreach (var character in value.AsSpan(1))
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '_' and not '-'
                && (!allowDot || character != '.'))
            {
                throw CreateException(label, stored);
            }
        }

        return value;
    }

    internal static Exception CreateException(string label, bool stored) =>
        stored
            ? new InvalidOperationException($"Stored {label} is not canonical")
            : new ArgumentException($"{label} is not canonical");

    internal static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
