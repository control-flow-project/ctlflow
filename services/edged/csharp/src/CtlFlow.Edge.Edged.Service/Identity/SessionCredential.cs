using System.Security.Cryptography;

namespace CtlFlow.Edge.Edged.Service.Identity;

internal sealed class SessionCredential : IDisposable
{
    private readonly byte[] _material;
    private bool _disposed;

    private SessionCredential(byte[] material) => _material = material;

    internal static SessionCredential? ParseCookie(string value)
    {
        var decoded = Array.Empty<byte>();
        try
        {
            if (value.Length != 43
                || value.Contains('=', StringComparison.Ordinal)
                || value.Any(character =>
                    character is not (
                        >= 'A' and <= 'Z'
                        or >= 'a' and <= 'z'
                        or >= '0' and <= '9'
                        or '-' or '_')))
            {
                return null;
            }

            decoded = Convert.FromBase64String(
                value.Replace('-', '+').Replace('_', '/') + "=");
            if (decoded.Length != 32
                || Encode(decoded) != value)
            {
                CryptographicOperations.ZeroMemory(decoded);
                return null;
            }

            return new SessionCredential(decoded);
        }
        catch (FormatException)
        {
            CryptographicOperations.ZeroMemory(decoded);
            return null;
        }
    }

    internal ReadOnlySpan<byte> ReadForIdentityExchange()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return _material;
    }

    public override string ToString() => "[REDACTED]";

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }
        _disposed = true;
        CryptographicOperations.ZeroMemory(_material);
    }

    private static string Encode(ReadOnlySpan<byte> value) =>
        Convert.ToBase64String(value)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
}
