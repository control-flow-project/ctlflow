using System.Security.Cryptography;

namespace CtlFlow.Auth.Authd.Domain.Oidc;

public sealed class PkceVerifier : IDisposable
{
    private readonly byte[] _material;
    private bool _disposed;

    private PkceVerifier(byte[] material) => _material = material;

    public static PkceVerifier Generate() =>
        new(RandomNumberGenerator.GetBytes(32));

    public string CreateChallenge()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var verifier = Encode(_material);
        return Encode(SHA256.HashData(
            System.Text.Encoding.ASCII.GetBytes(verifier)));
    }

    public string ReadForTokenRequest()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return Encode(_material);
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
