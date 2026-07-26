using System.Security.Cryptography;
using CtlFlow.Identity.Identityd.Domain.Sessions;
using CtlFlow.Identity.Identityd.Service.Security.Tokens;

namespace CtlFlow.Identity.Identityd.Service.Security.Sessions;

internal sealed class SessionCredential : IDisposable
{
    private const int MaterialLength = 32;
    private readonly byte[] _material;

    private SessionCredential(byte[] material)
    {
        _material = material;
    }

    internal static SessionCredential Generate() =>
        new(RandomNumberGenerator.GetBytes(MaterialLength));

    internal static SessionCredential Parse(ReadOnlySpan<byte> material)
    {
        if (material.Length != MaterialLength)
        {
            throw new TokenValidationException();
        }

        return new SessionCredential(material.ToArray());
    }

    internal SessionCredentialDigest CreateDigest() =>
        SessionCredentialDigest.FromDigest(
            Convert.ToHexString(SHA256.HashData(_material))
                .ToLowerInvariant());

    internal byte[] ReadForResponse() => _material.ToArray();

    public void Dispose() =>
        CryptographicOperations.ZeroMemory(_material);

    public override string ToString() => "[REDACTED]";
}
