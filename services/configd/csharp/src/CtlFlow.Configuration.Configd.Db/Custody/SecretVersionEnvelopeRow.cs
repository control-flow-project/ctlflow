namespace CtlFlow.Configuration.Configd.Db.Custody;

public class SecretVersionEnvelopeRow
{
    private SecretVersionEnvelopeRow()
    {
    }

    internal SecretVersionEnvelopeRow(
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
        long createdAtUnixMilliseconds)
    {
        SecretVersionId = secretVersionId;
        SecretId = secretId;
        Ciphertext = ciphertext;
        MaterialLength = materialLength;
        Nonce = nonce;
        AuthenticationTag = authenticationTag;
        EncryptionKeyId = encryptionKeyId;
        RequestExpectedRevision = requestExpectedRevision;
        DependencyClaimId = dependencyClaimId;
        DependencyClaimRevision = dependencyClaimRevision;
        AuditEventId = auditEventId;
        CreatedAtUnixMilliseconds = createdAtUnixMilliseconds;
    }

    internal string SecretVersionId { get; set; } = null!;

    internal string SecretId { get; set; } = null!;

    internal byte[] Ciphertext { get; set; } = null!;

    internal int MaterialLength { get; set; }

    internal byte[] Nonce { get; set; } = null!;

    internal byte[] AuthenticationTag { get; set; } = null!;

    internal string EncryptionKeyId { get; set; } = null!;

    internal long? RequestExpectedRevision { get; set; }

    internal string? DependencyClaimId { get; set; }

    internal long? DependencyClaimRevision { get; set; }

    internal string AuditEventId { get; set; } = null!;

    internal long CreatedAtUnixMilliseconds { get; set; }
}
