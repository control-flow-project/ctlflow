using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Audit.Auditd.Db.Events;

internal static partial class AuditEventSchema
{
    internal static void ConfigurePackageDeclaration(ModelBuilder modelBuilder)
    {
        var detail = modelBuilder.Entity<PackageDeclarationAuditDetail>();
        detail.ToTable("audit_package_declarations");
        detail.HasKey(value => value.EventKey);
        detail.Ignore(value => value.Kind);
        detail.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        detail.HasOne<AuditRecord>()
            .WithOne()
            .HasForeignKey<PackageDeclarationAuditDetail>(
                value => value.EventKey)
            .OnDelete(DeleteBehavior.Restrict);
        detail.Property(value => value.PackageId)
            .HasColumnName("package_id")
            .HasMaxLength(128)
            .IsRequired();
        detail.Property(value => value.Generation)
            .HasColumnName("generation")
            .IsRequired();
    }

    internal static void ConfigureAppMutation(ModelBuilder modelBuilder)
    {
        var detail = modelBuilder.Entity<AppMutationAuditDetail>();
        detail.ToTable("audit_app_mutations");
        detail.HasKey(value => value.EventKey);
        detail.Ignore(value => value.Kind);
        detail.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        detail.HasOne<AuditRecord>()
            .WithOne()
            .HasForeignKey<AppMutationAuditDetail>(
                value => value.EventKey)
            .OnDelete(DeleteBehavior.Restrict);
        detail.Ignore(value => value.Scope);
        detail.Property(value => value.AppId)
            .HasColumnName("app_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.ScopeKind)
            .HasConversion<int>()
            .HasColumnName("scope_kind")
            .IsRequired();
        detail.Property(value => value.ScopeTenantId)
            .HasColumnName("scope_tenant_id")
            .HasMaxLength(64);
        detail.Property(value => value.ScopeWorkspaceId)
            .HasColumnName("scope_workspace_id")
            .HasMaxLength(64);
        detail.Property(value => value.ScopeAccountPrincipalId)
            .HasColumnName("scope_account_principal_id")
            .HasMaxLength(256);
        detail.Property(value => value.PlacementId)
            .HasColumnName("placement_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.PackageId)
            .HasColumnName("package_id")
            .HasMaxLength(128)
            .IsRequired();
        detail.Property(value => value.PackageGeneration)
            .HasColumnName("package_generation")
            .IsRequired();
        detail.Property(value => value.AppRevision)
            .HasColumnName("app_revision")
            .IsRequired();
        detail.Property(value => value.Action)
            .HasColumnName("action")
            .IsRequired();
    }
}
