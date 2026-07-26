namespace CtlFlow.Tenancy.Tenantd.Domain.Identifiers;

internal static partial class Identifiers
{
    internal static string ValidateIdentifier(string value, string label)
    {
        if (!IsCanonical(value))
        {
            throw new ArgumentException($"{label} is not canonical", nameof(value));
        }

        return value;
    }

    internal static string ValidateStoredIdentifier(string value, string label)
    {
        if (!IsCanonical(value))
        {
            throw new InvalidOperationException($"Stored {label} is not canonical");
        }

        return value;
    }

    private static bool IsCanonical(string value)
    {
        if (string.IsNullOrEmpty(value)
            || value.Length > 64
            || !IsLowerAlphaNumeric(value[0]))
        {
            return false;
        }

        foreach (var character in value.AsSpan(1))
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '_' and not '-')
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
