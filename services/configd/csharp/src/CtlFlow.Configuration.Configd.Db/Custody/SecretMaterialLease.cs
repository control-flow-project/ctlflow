using System.Security.Cryptography;

namespace CtlFlow.Configuration.Configd.Db.Custody;

public sealed class SecretMaterialLease : IDisposable
{
    private byte[]? _material;

    internal SecretMaterialLease(byte[] material) => _material = material;

    public int Length => RequireMaterial().Length;

    public void CopyTo(Span<byte> destination)
    {
        var material = RequireMaterial();
        if (destination.Length < material.Length)
        {
            throw new ArgumentException(
                "Secret destination is too small",
                nameof(destination));
        }

        material.CopyTo(destination);
    }

    public bool FixedTimeEquals(ReadOnlySpan<byte> other)
    {
        var material = RequireMaterial();
        return material.Length == other.Length
            && CryptographicOperations.FixedTimeEquals(material, other);
    }

    public void Dispose()
    {
        var material = Interlocked.Exchange(ref _material, null);
        if (material is not null)
        {
            CryptographicOperations.ZeroMemory(material);
        }
    }

    internal ReadOnlySpan<byte> Span => RequireMaterial();

    private byte[] RequireMaterial() =>
        _material ?? throw new ObjectDisposedException(
            nameof(SecretMaterialLease));
}
