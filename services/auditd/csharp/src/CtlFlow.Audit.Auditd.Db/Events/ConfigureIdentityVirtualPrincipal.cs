using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Audit.Auditd.Db.Events;

internal static partial class AuditEventSchema
{
    internal static void ConfigureIdentityVirtualPrincipal(
        ModelBuilder modelBuilder)
    {
        var detail =
            modelBuilder.Entity<IdentityVirtualPrincipalAuditDetail>();
        detail.ToTable("audit_identity_virtual_principals");
        detail.HasKey(value => value.EventKey);
        detail.Ignore(value => value.Kind);
        detail.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        detail.HasOne<AuditRecord>()
            .WithOne()
            .HasForeignKey<IdentityVirtualPrincipalAuditDetail>(
                value => value.EventKey)
            .OnDelete(DeleteBehavior.Restrict);
        detail.Property(value => value.PrincipalId)
            .HasColumnName("principal_id")
            .HasMaxLength(256)
            .IsRequired();
        detail.Property(value => value.AttachedAccountPrincipalId)
            .HasColumnName("attached_account_principal_id")
            .HasMaxLength(256)
            .IsRequired();
        detail.Property(value => value.WorkspaceId)
            .HasColumnName("workspace_id")
            .HasMaxLength(64);
        detail.Property(value => value.PrincipalRevision)
            .HasColumnName("principal_revision")
            .IsRequired();
        detail.Property(value => value.Enabled)
            .HasColumnName("enabled")
            .IsRequired();
        detail.Property(value => value.Action)
            .HasColumnName("action")
            .IsRequired();
    }
}
