using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Resources;

internal static partial class ResourceSchema
{
    internal static void ConfigureResourceEvent(ModelBuilder modelBuilder)
    {
        var resourceEvent = modelBuilder.Entity<ResourceEvent>();
        resourceEvent.ToTable("resource_events");
        resourceEvent.HasKey(value => value.EventSequence);
        resourceEvent.Property(value => value.EventSequence)
            .HasColumnName("event_sequence")
            .ValueGeneratedNever();
        resourceEvent.Property(value => value.ResourceKind)
            .HasColumnName("resource_kind");
        resourceEvent.Property(value => value.EventKind)
            .HasColumnName("event_kind");
        resourceEvent.Property(value => value.TenantId)
            .HasColumnName("tenant_id")
            .HasMaxLength(64);
        resourceEvent.Property(value => value.WorkspaceId)
            .HasColumnName("workspace_id")
            .HasMaxLength(64);
        resourceEvent.Property(value => value.DisplayName)
            .HasColumnName("display_name")
            .HasMaxLength(200);
        resourceEvent.Property(value => value.LifecycleState)
            .HasColumnName("lifecycle_state");
        resourceEvent.Property(value => value.ResourceRevision)
            .HasColumnName("resource_revision");
        resourceEvent.Property(value => value.ProvisioningGeneration)
            .HasColumnName("provisioning_generation");
        resourceEvent.Property(value => value.CurrentOperationId)
            .HasColumnName("current_operation_id")
            .HasMaxLength(64);
        resourceEvent.Property(value => value.EventAtUnixMilliseconds)
            .HasColumnName("event_at_unix_ms");
        resourceEvent.HasIndex(value => new
        {
            value.ResourceKind,
            value.EventSequence
        });
        resourceEvent.HasIndex(value => new
        {
            value.TenantId,
            value.ResourceKind,
            value.EventSequence
        });
        resourceEvent.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey(value => value.TenantId)
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
        resourceEvent.HasOne<Workspace>()
            .WithMany()
            .HasForeignKey(value => value.WorkspaceId)
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
