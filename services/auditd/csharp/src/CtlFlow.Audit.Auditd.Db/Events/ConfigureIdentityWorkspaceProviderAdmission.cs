using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Audit.Auditd.Db.Events;

internal static partial class AuditEventSchema
{
    internal static void ConfigureIdentityWorkspaceProviderAdmission(
        ModelBuilder modelBuilder)
    {
        var detail = modelBuilder.Entity<
            IdentityWorkspaceProviderAdmissionAuditDetail>();
        detail.ToTable("audit_identity_workspace_provider_admissions");
        detail.HasKey(value => value.EventKey);
        detail.Ignore(value => value.Kind);
        detail.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        detail.HasOne<AuditRecord>()
            .WithOne()
            .HasForeignKey<
                IdentityWorkspaceProviderAdmissionAuditDetail>(
                value => value.EventKey)
            .OnDelete(DeleteBehavior.Restrict);
        detail.Property(value => value.WorkspaceId)
            .HasColumnName("workspace_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.ProviderId)
            .HasColumnName("provider_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.Action)
            .HasColumnName("action")
            .IsRequired();
    }
}
