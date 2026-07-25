using System.Security.Cryptography;

namespace CtlFlow.Tenancy.Tenantd.Domain.Identifiers;

internal static class OpaqueIdentifiers
{
    private const int MaximumLength = 64;

    internal static string Generate(string prefix) =>
        $"{prefix}_{Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant()}";

    internal static string Validate(string value, string name)
    {
        if (!IsCanonical(value))
        {
            throw new ArgumentException($"{name} is not canonical", nameof(value));
        }

        return value;
    }

    internal static string ValidateStored(string value, string name)
    {
        if (!IsCanonical(value))
        {
            throw new InvalidOperationException($"Stored {name} is not canonical");
        }

        return value;
    }

    private static bool IsCanonical(string value)
    {
        if (string.IsNullOrEmpty(value)
            || value.Length > MaximumLength
            || !IsLowerAlphaNumeric(value[0]))
        {
            return false;
        }

        for (var index = 1; index < value.Length; index++)
        {
            var character = value[index];
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
