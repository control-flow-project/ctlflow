using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace CtlFlow.Audit.Auditd.Db.Events;

internal static partial class AuditEventSchema
{
    internal static void ConfigureConfigurationPublication(
        ModelBuilder modelBuilder)
    {
        var detail =
            modelBuilder.Entity<ConfigurationPublicationAuditDetail>();
        detail.ToTable("audit_configuration_publications");
        detail.HasKey(value => value.EventKey);
        detail.Ignore(value => value.Kind);
        detail.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        detail.HasOne<AuditRecord>()
            .WithOne()
            .HasForeignKey<ConfigurationPublicationAuditDetail>(
                value => value.EventKey)
            .OnDelete(DeleteBehavior.Restrict);
        detail.Ignore(value => value.Binding);
        detail.Property(value => value.ConfigurationId)
            .HasColumnName("configuration_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.ConfigurationVersionId)
            .HasColumnName("configuration_version_id")
            .HasMaxLength(64)
            .IsRequired();
        ConfigurePublication(detail);
    }

    internal static void ConfigureSecretPublication(ModelBuilder modelBuilder)
    {
        var detail = modelBuilder.Entity<SecretPublicationAuditDetail>();
        detail.ToTable("audit_secret_publications");
        detail.HasKey(value => value.EventKey);
        detail.Ignore(value => value.Kind);
        detail.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        detail.HasOne<AuditRecord>()
            .WithOne()
            .HasForeignKey<SecretPublicationAuditDetail>(
                value => value.EventKey)
            .OnDelete(DeleteBehavior.Restrict);
        detail.Ignore(value => value.Binding);
        detail.Property(value => value.SecretId)
            .HasColumnName("secret_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.SecretVersionId)
            .HasColumnName("secret_version_id")
            .HasMaxLength(64)
            .IsRequired();
        ConfigurePublication(detail);
    }

    private static void ConfigurePublication(
        EntityTypeBuilder<ConfigurationPublicationAuditDetail> detail)
    {
        detail.Property(value => value.BindingPlacementId)
            .HasColumnName("binding_placement_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.BindingTargetKind)
            .HasConversion<int>()
            .HasColumnName("binding_target_kind")
            .IsRequired();
        detail.Property(value => value.BindingTenantId)
            .HasColumnName("binding_target_tenant_id")
            .HasMaxLength(64);
        detail.Property(value => value.BindingWorkspaceId)
            .HasColumnName("binding_target_workspace_id")
            .HasMaxLength(64);
        detail.Property(value => value.BindingAccountPrincipalId)
            .HasColumnName("binding_target_account_principal_id")
            .HasMaxLength(256);
        detail.Property(value => value.BindingConsumerId)
            .HasColumnName("binding_consumer_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.BindingPurpose)
            .HasColumnName("binding_purpose")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.IdentityRevision)
            .HasColumnName("identity_revision")
            .IsRequired();
        detail.Property(value => value.DependencyClaimId)
            .HasColumnName("dependency_claim_id")
            .HasMaxLength(64);
        detail.Property(value => value.DependencyClaimRevision)
            .HasColumnName("dependency_claim_revision");
    }

    private static void ConfigurePublication(
        EntityTypeBuilder<SecretPublicationAuditDetail> detail)
    {
        detail.Property(value => value.BindingPlacementId)
            .HasColumnName("binding_placement_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.BindingTargetKind)
            .HasConversion<int>()
            .HasColumnName("binding_target_kind")
            .IsRequired();
        detail.Property(value => value.BindingTenantId)
            .HasColumnName("binding_target_tenant_id")
            .HasMaxLength(64);
        detail.Property(value => value.BindingWorkspaceId)
            .HasColumnName("binding_target_workspace_id")
            .HasMaxLength(64);
        detail.Property(value => value.BindingAccountPrincipalId)
            .HasColumnName("binding_target_account_principal_id")
            .HasMaxLength(256);
        detail.Property(value => value.BindingConsumerId)
            .HasColumnName("binding_consumer_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.BindingPurpose)
            .HasColumnName("binding_purpose")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.IdentityRevision)
            .HasColumnName("identity_revision")
            .IsRequired();
        detail.Property(value => value.DependencyClaimId)
            .HasColumnName("dependency_claim_id")
            .HasMaxLength(64);
        detail.Property(value => value.DependencyClaimRevision)
            .HasColumnName("dependency_claim_revision");
    }
}
