namespace CtlFlow.Configuration.Configd.Db.Custody;

public static partial class SecretCustody
{
    internal static SecretVersionEnvelopeRow RestoreSecretVersionEnvelope(
        string secretVersionId,
        string secretId,
        byte[] ciphertext,
        int materialLength,
        byte[] nonce,
        byte[] authenticationTag,
        string encryptionKeyId,
        long? requestExpectedRevision,
        string? dependencyClaimId,
        long? dependencyClaimRevision,
        string auditEventId,
        long createdAtUnixMilliseconds) =>
        new(
            secretVersionId,
            secretId,
            ciphertext,
            materialLength,
            nonce,
            authenticationTag,
            encryptionKeyId,
            requestExpectedRevision,
            dependencyClaimId,
            dependencyClaimRevision,
            auditEventId,
            createdAtUnixMilliseconds);
}
