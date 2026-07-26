using System.Security.Cryptography;
using CtlFlow.Identity.Identityd.Domain.Keys;

namespace CtlFlow.Identity.Identityd.Service.Security.Signing;

internal sealed class InvocationSigningKey(
    VerificationKeyId keyId,
    RSA key) : IDisposable
{
    private readonly RSA _key = key;

    internal VerificationKeyId KeyId { get; } = keyId;

    internal byte[] Sign(ReadOnlySpan<byte> material) =>
        _key.SignData(
            material,
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);

    internal RSAParameters ExportPublicParameters() =>
        _key.ExportParameters(includePrivateParameters: false);

    public void Dispose() => _key.Dispose();

    public override string ToString() => "[REDACTED]";
}
