using System.Security.Cryptography;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;

namespace CtlFlow.Configuration.Configd.Db.Custody;

public static partial class SecretCustody
{
    internal static SecretMaterialLease DecryptSecretVersion(
        SecretVersionEnvelopeRow envelope,
        ConsumerBinding binding,
        EncryptionKeyRing keyRing)
    {
        using var activity =
            ConfigurationCryptoTelemetry.StartOperation("decrypt_secret");
        var succeeded = false;
        var keyId = EncryptionKeyId.FromStorage(envelope.EncryptionKeyId);
        var key = keyRing.Get(keyId);
        Span<byte> keyMaterial = stackalloc byte[32];
        key.CopyTo(keyMaterial);
        var plaintext = new byte[envelope.MaterialLength];
        var additionalData = CreateSecretAdditionalData(
            keyId,
            SecretId.FromStorage(envelope.SecretId),
            SecretVersionId.FromStorage(envelope.SecretVersionId),
            binding);
        try
        {
            using var algorithm = new AesGcm(
                keyMaterial,
                envelope.AuthenticationTag.Length);
            algorithm.Decrypt(
                envelope.Nonce,
                envelope.Ciphertext,
                envelope.AuthenticationTag,
                plaintext,
                additionalData);
            succeeded = true;
            return new SecretMaterialLease(plaintext);
        }
        catch
        {
            CryptographicOperations.ZeroMemory(plaintext);
            throw;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(keyMaterial);
            ConfigurationCryptoTelemetry.Complete(
                activity,
                succeeded);
        }
    }
}
