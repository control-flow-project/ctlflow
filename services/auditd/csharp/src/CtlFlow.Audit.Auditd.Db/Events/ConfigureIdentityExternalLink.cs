using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Audit.Auditd.Db.Events;

internal static partial class AuditEventSchema
{
    internal static void ConfigureIdentityExternalLink(
        ModelBuilder modelBuilder)
    {
        var detail = modelBuilder.Entity<IdentityExternalLinkAuditDetail>();
        detail.ToTable("audit_identity_external_links");
        detail.HasKey(value => value.EventKey);
        detail.Ignore(value => value.Kind);
        detail.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        detail.HasOne<AuditRecord>()
            .WithOne()
            .HasForeignKey<IdentityExternalLinkAuditDetail>(
                value => value.EventKey)
            .OnDelete(DeleteBehavior.Restrict);
        detail.Property(value => value.ExternalLinkId)
            .HasColumnName("external_link_id")
            .HasMaxLength(36)
            .IsRequired();
        detail.Property(value => value.ProviderId)
            .HasColumnName("provider_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.HumanAccountPrincipalId)
            .HasColumnName("human_account_principal_id")
            .HasMaxLength(256)
            .IsRequired();
        detail.Property(value => value.Action)
            .HasColumnName("action")
            .IsRequired();
    }
}
