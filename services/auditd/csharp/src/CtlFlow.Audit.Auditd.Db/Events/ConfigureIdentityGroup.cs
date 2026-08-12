using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Audit.Auditd.Db.Events;

internal static partial class AuditEventSchema
{
    internal static void ConfigureIdentityGroup(ModelBuilder modelBuilder)
    {
        var detail = modelBuilder.Entity<IdentityGroupAuditDetail>();
        detail.ToTable("audit_identity_groups");
        detail.HasKey(value => value.EventKey);
        detail.Ignore(value => value.Kind);
        detail.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        detail.HasOne<AuditRecord>()
            .WithOne()
            .HasForeignKey<IdentityGroupAuditDetail>(
                value => value.EventKey)
            .OnDelete(DeleteBehavior.Restrict);
        detail.Property(value => value.GroupId)
            .HasColumnName("group_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.WorkspaceId)
            .HasColumnName("workspace_id")
            .HasMaxLength(64);
        detail.Property(value => value.Action)
            .HasColumnName("action")
            .IsRequired();
    }
}
