using CtlFlow.Configuration.Configd.Domain.Configurations;
using Microsoft.EntityFrameworkCore;
using ConfigurationEntity =
    CtlFlow.Configuration.Configd.Domain.Configurations.ConfigurationResource;

namespace CtlFlow.Configuration.Configd.Db.Content;

internal static partial class ConfigurationContentSchema
{
    internal static void ConfigureConfigurationVersionContent(
        ModelBuilder modelBuilder)
    {
        var version =
            modelBuilder.Entity<ConfigurationVersionContentRow>();
        version.ToTable("configuration_versions");
        version.HasKey(value => value.ConfigurationVersionId);
        version.Property(value => value.ConfigurationVersionId)
            .HasColumnName("configuration_version_id")
            .HasMaxLength(64)
            .ValueGeneratedNever()
            .IsRequired();
        version.Property(value => value.ConfigurationId)
            .HasColumnName("configuration_id")
            .HasMaxLength(64)
            .IsRequired();
        version.Property(value => value.ContentJson)
            .HasColumnName("content_json")
            .HasMaxLength(65_536)
            .IsRequired();
        version.Property(value => value.ContentLength)
            .HasColumnName("content_length")
            .IsRequired();
        version.Property(value => value.ContentSha256)
            .HasColumnName("content_sha256")
            .HasMaxLength(32)
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
        version.HasOne<ConfigurationEntity>()
            .WithMany()
            .HasForeignKey(value => value.ConfigurationId)
            .OnDelete(DeleteBehavior.Restrict)
            .IsRequired();
        version.HasIndex(value => new
        {
            value.ConfigurationId,
            value.ConfigurationVersionId
        }).HasDatabaseName("configuration_versions_parent_idx");
    }
}
