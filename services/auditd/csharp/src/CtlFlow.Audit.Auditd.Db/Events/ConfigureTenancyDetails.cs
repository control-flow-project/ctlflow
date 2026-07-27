using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Audit.Auditd.Db.Events;

internal static partial class AuditEventSchema
{
    internal static void ConfigureTenantMutation(ModelBuilder modelBuilder)
    {
        var detail = modelBuilder.Entity<TenantMutationAuditDetail>();
        detail.ToTable("audit_tenant_mutations");
        detail.HasKey(value => value.EventKey);
        detail.Ignore(value => value.Kind);
        detail.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        detail.HasOne<AuditRecord>()
            .WithOne()
            .HasForeignKey<TenantMutationAuditDetail>(
                value => value.EventKey)
            .OnDelete(DeleteBehavior.Restrict);
        detail.Property(value => value.Action)
            .HasColumnName("action")
            .IsRequired();
        detail.Property(value => value.ResourceRevision)
            .HasColumnName("resource_revision")
            .IsRequired();
        detail.Property(value => value.ResultingState)
            .HasColumnName("resulting_state")
            .IsRequired();
    }

    internal static void ConfigureWorkspaceMutation(ModelBuilder modelBuilder)
    {
        var detail = modelBuilder.Entity<WorkspaceMutationAuditDetail>();
        detail.ToTable("audit_workspace_mutations");
        detail.HasKey(value => value.EventKey);
        detail.Ignore(value => value.Kind);
        detail.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        detail.HasOne<AuditRecord>()
            .WithOne()
            .HasForeignKey<WorkspaceMutationAuditDetail>(
                value => value.EventKey)
            .OnDelete(DeleteBehavior.Restrict);
        detail.Property(value => value.WorkspaceId)
            .HasColumnName("workspace_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.Action)
            .HasColumnName("action")
            .IsRequired();
        detail.Property(value => value.ResourceRevision)
            .HasColumnName("resource_revision")
            .IsRequired();
        detail.Property(value => value.ResultingState)
            .HasColumnName("resulting_state")
            .IsRequired();
    }
}
