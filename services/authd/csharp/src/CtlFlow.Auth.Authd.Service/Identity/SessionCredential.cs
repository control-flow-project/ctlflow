using System.Security.Cryptography;

namespace CtlFlow.Auth.Authd.Service.Identity;

internal sealed class SessionCredential : IDisposable
{
    private readonly byte[] _material;
    private bool _disposed;

    private SessionCredential(byte[] material) => _material = material;

    internal static SessionCredential FromIdentityd(
        ReadOnlySpan<byte> value)
    {
        if (value.Length != 32)
        {
            throw new InvalidDataException(
                "Identityd returned an invalid Session credential");
        }
        return new SessionCredential(value.ToArray());
    }

    internal static SessionCredential? ParseCookie(string value)
    {
        if (!BrowserValues.TryDecode(value, out var decoded)
            || decoded.Length != 32
            || BrowserValues.Encode(decoded) != value)
        {
            CryptographicOperations.ZeroMemory(decoded);
            return null;
        }
        return new SessionCredential(decoded);
    }

    internal string EncodeForCookie()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return BrowserValues.Encode(_material);
    }

    internal ReadOnlySpan<byte> ReadForRevocation()
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
}
