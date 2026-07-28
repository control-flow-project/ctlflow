using CtlFlow.Configuration.Configd.Domain.Secrets;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Configuration.Configd.Db.Custody;

internal static partial class SecretCustodySchema
{
    internal static void ConfigureSecretVersionEnvelope(
        ModelBuilder modelBuilder)
    {
        var version = modelBuilder.Entity<SecretVersionEnvelopeRow>();
        version.ToTable("secret_versions");
        version.HasKey(value => value.SecretVersionId);
        version.Property(value => value.SecretVersionId)
            .HasColumnName("secret_version_id")
            .HasMaxLength(64)
            .ValueGeneratedNever()
            .IsRequired();
        version.Property(value => value.SecretId)
            .HasColumnName("secret_id")
            .HasMaxLength(64)
            .IsRequired();
        version.Property(value => value.Ciphertext)
            .HasColumnName("ciphertext")
            .HasMaxLength(65_536)
            .IsRequired();
        version.Property(value => value.MaterialLength)
            .HasColumnName("material_length")
            .IsRequired();
        version.Property(value => value.Nonce)
            .HasColumnName("nonce")
            .HasMaxLength(12)
            .IsRequired();
        version.Property(value => value.AuthenticationTag)
            .HasColumnName("authentication_tag")
            .HasMaxLength(16)
            .IsRequired();
        version.Property(value => value.EncryptionKeyId)
            .HasColumnName("encryption_key_id")
            .HasMaxLength(64)
            .IsRequired();
        version.Property(value => value.RequestExpectedRevision)
            .HasColumnName("request_expected_revision")
            .IsRequired(false);
        version.Property(value => value.DependencyClaimId)
            .HasColumnName("dependency_claim_id")
            .HasMaxLength(36)
            .IsRequired(false);
        version.Property(value => value.DependencyClaimRevision)
            .HasColumnName("dependency_claim_revision")
            .IsRequired(false);
        version.Property(value => value.AuditEventId)
            .HasColumnName("audit_event_id")
            .HasMaxLength(36)
            .IsRequired();
        version.Property(value => value.CreatedAtUnixMilliseconds)
            .HasColumnName("created_at_unix_ms")
            .IsRequired();
        version.HasOne<Secret>()
            .WithMany()
            .HasForeignKey(value => value.SecretId)
            .OnDelete(DeleteBehavior.Restrict)
            .IsRequired();
        version.HasIndex(value => new
        {
            value.SecretId,
            value.SecretVersionId
        }).HasDatabaseName("secret_versions_parent_idx");
        version.HasIndex(value => value.EncryptionKeyId)
            .HasDatabaseName("secret_versions_key_idx");
    }
}
