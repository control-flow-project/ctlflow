using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Audit.Auditd.Db.Events;

internal static partial class AuditEventSchema
{
    internal static void ConfigureIdentitySession(ModelBuilder modelBuilder)
    {
        var detail = modelBuilder.Entity<IdentitySessionAuditDetail>();
        detail.ToTable("audit_identity_sessions");
        detail.HasKey(value => value.EventKey);
        detail.Ignore(value => value.Kind);
        detail.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        detail.HasOne<AuditRecord>()
            .WithOne()
            .HasForeignKey<IdentitySessionAuditDetail>(
                value => value.EventKey)
            .OnDelete(DeleteBehavior.Restrict);
        detail.Property(value => value.SessionId)
            .HasColumnName("session_id")
            .HasMaxLength(32)
            .IsRequired();
        detail.Property(value => value.HumanAccountPrincipalId)
            .HasColumnName("human_account_principal_id")
            .HasMaxLength(256)
            .IsRequired();
        detail.Property(value => value.SessionRevision)
            .HasColumnName("session_revision")
            .IsRequired();
        detail.Property(value => value.Action)
            .HasColumnName("action")
            .IsRequired();
    }
}
