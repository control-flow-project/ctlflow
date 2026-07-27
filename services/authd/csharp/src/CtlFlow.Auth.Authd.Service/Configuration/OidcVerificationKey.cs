using System.Security.Cryptography;

namespace CtlFlow.Auth.Authd.Service.Configuration;

internal sealed class OidcVerificationKey(
    string keyId,
    byte[] modulus,
    byte[] exponent)
{
    internal string KeyId { get; } = keyId;

    internal bool Verify(
        ReadOnlySpan<byte> data,
        ReadOnlySpan<byte> signature)
    {
        using var rsa = RSA.Create();
        rsa.ImportParameters(new RSAParameters
        {
            Modulus = modulus,
            Exponent = exponent
        });
        return rsa.VerifyData(
            data,
            signature,
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);
    }
}
