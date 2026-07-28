using System.Security.Cryptography;
using CtlFlow.Configuration.Configd.Domain.Secrets;

namespace CtlFlow.Configuration.Configd.Db.Custody;

public static partial class SecretCustody
{
    internal static SecretVersionEnvelopeRow EncryptSecretVersion(
        SecretMutationResult.Changed changed,
        SecretDraft draft,
        SecretMaterialLease material,
        EncryptionKeyRing keyRing)
    {
        using var activity =
            ConfigurationCryptoTelemetry.StartOperation("encrypt_secret");
        var succeeded = false;
        var keyId = keyRing.ActiveKeyId;
        var key = keyRing.Get(keyId);
        Span<byte> keyMaterial = stackalloc byte[32];
        key.CopyTo(keyMaterial);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var ciphertext = new byte[material.Length];
        var tag = new byte[16];
        var additionalData = CreateSecretAdditionalData(
            keyId,
            draft.Id,
            draft.VersionId,
            draft.Binding);
        try
        {
            using var algorithm = new AesGcm(keyMaterial, tag.Length);
            algorithm.Encrypt(
                nonce,
                material.Span,
                ciphertext,
                tag,
                additionalData);
            succeeded = true;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(keyMaterial);
            ConfigurationCryptoTelemetry.Complete(
                activity,
                succeeded);
        }

        return new SecretVersionEnvelopeRow(
            draft.VersionId.Value,
            draft.Id.Value,
            ciphertext,
            material.Length,
            nonce,
            tag,
            keyId.Value,
            draft.ExpectedRevision?.Value,
            draft.DependencyClaim?.Id.Value,
            draft.DependencyClaim?.Revision.Value,
            changed.Audit.Envelope.EventId.Value,
            changed.Version.CreatedAt.UnixMilliseconds);
    }
}
