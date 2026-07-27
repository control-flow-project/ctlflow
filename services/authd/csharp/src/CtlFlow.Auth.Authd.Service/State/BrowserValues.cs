using System.Security.Cryptography;

namespace CtlFlow.Auth.Authd.Service;

internal static class BrowserValues
{
    internal static string Generate() =>
        Encode(RandomNumberGenerator.GetBytes(32));

    internal static bool IsCanonical32ByteValue(string value) =>
        TryDecode(value, out var decoded)
        && decoded.Length == 32
        && Encode(decoded) == value;

    internal static byte[] CreateDigest(string value)
    {
        if (!TryDecode(value, out var decoded) || decoded.Length != 32)
        {
            throw new ArgumentException(
                "Browser value is invalid",
                nameof(value));
        }

        try
        {
            return SHA256.HashData(decoded);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(decoded);
        }
    }

    internal static string Encode(ReadOnlySpan<byte> value) =>
        Convert.ToBase64String(value)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');

    internal static bool TryDecode(string value, out byte[] decoded)
    {
        decoded = [];
        if (value.Length != 43)
        {
            return false;
        }
        foreach (var character in value)
        {
            if (character is not (>= 'A' and <= 'Z'
                or >= 'a' and <= 'z'
                or >= '0' and <= '9'
                or '_'
                or '-'))
            {
                return false;
            }
        }

        var padded = value
            .Replace('-', '+')
            .Replace('_', '/')
            .PadRight(44, '=');
        try
        {
            decoded = Convert.FromBase64String(padded);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
