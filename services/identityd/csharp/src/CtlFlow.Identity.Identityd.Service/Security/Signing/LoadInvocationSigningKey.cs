using System.Security.Cryptography;
using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Keys;
using CtlFlow.Identity.Identityd.Service.Configuration;
using IdentityKeys =
    CtlFlow.Identity.Identityd.Db.Keys.VerificationKeys;

namespace CtlFlow.Identity.Identityd.Service.Security.Signing;

internal static partial class InvocationSigningKeys
{
    internal static async Task<InvocationSigningKey>
        LoadInvocationSigningKey(
            IdentityDatabase identityDatabase,
            SigningSettings settings,
            CancellationToken cancellation)
    {
        var pem = await File.ReadAllTextAsync(
            settings.PrivateKeyPath,
            cancellation);
        var key = RSA.Create();
        try
        {
            key.ImportFromPem(pem);
            var signingKey = new InvocationSigningKey(
                settings.KeyId,
                key);
            await VerifyInvocationSigningKey(
                identityDatabase,
                signingKey,
                cancellation);
            return signingKey;
        }
        catch
        {
            key.Dispose();
            throw;
        }
    }

    internal static async Task VerifyInvocationSigningKey(
        IdentityDatabase identityDatabase,
        InvocationSigningKey signingKey,
        CancellationToken cancellation)
    {
        var keySet = await IdentityKeys
            .GetInvocationVerificationKeys(
                identityDatabase,
                cancellation);
        var active = keySet.Keys.SingleOrDefault(
            key => key.State == VerificationKeyState.Active);
        if (active is null
            || active.KeyId != signingKey.KeyId
            || active.Algorithm != VerificationKeyAlgorithm.Rs256)
        {
            throw new InvalidOperationException(
                "Invocation signing key does not match active key state");
        }

        var parameters = signingKey.ExportPublicParameters();
        if (parameters.Modulus is null
            || parameters.Exponent is null
            || EncodeBase64Url(parameters.Modulus)
                != active.Modulus.Value
            || EncodeBase64Url(parameters.Exponent)
                != active.Exponent.Value)
        {
            throw new InvalidOperationException(
                "Invocation signing key public material does not match");
        }
    }

    private static string EncodeBase64Url(ReadOnlySpan<byte> value) =>
        Convert.ToBase64String(value)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
}
