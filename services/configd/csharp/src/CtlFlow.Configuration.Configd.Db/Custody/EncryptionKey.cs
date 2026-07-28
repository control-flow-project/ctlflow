using System.Security.Cryptography;

namespace CtlFlow.Configuration.Configd.Db.Custody;

internal sealed class EncryptionKey(
    EncryptionKeyId id,
    byte[] material) : IDisposable
{
    private byte[]? _material = material;

    internal EncryptionKeyId Id { get; } = id;

    internal void CopyTo(Span<byte> destination)
    {
        var material = RequireMaterial();
        if (destination.Length != material.Length)
        {
            throw new ArgumentException(
                "Encryption key destination has the wrong size",
                nameof(destination));
        }

        material.CopyTo(destination);
    }

    public void Dispose()
    {
        var material = Interlocked.Exchange(ref _material, null);
        if (material is not null)
        {
            CryptographicOperations.ZeroMemory(material);
        }
    }

    private byte[] RequireMaterial() =>
        _material ?? throw new ObjectDisposedException(nameof(EncryptionKey));
}
