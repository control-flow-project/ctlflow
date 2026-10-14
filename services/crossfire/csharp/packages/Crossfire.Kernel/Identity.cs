using System.Security.Cryptography;
using System.Text;

namespace Crossfire.Kernel;

public static class Identity
{
    public static string Identifier() => Guid.NewGuid().ToString("D");
    public static string Secret() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static string VerificationCode() => Convert.ToHexString(RandomNumberGenerator.GetBytes(6));
    public static string Hash(string text) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    public static bool Matches(string text, string digest)
    {
        if (digest.Length != 64 || !digest.All(Uri.IsHexDigit)) return false;
        return CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(text)), Convert.FromHexString(digest));
    }
    public static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}
