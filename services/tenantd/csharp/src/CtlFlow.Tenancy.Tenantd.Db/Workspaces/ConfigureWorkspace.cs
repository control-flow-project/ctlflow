using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

internal static partial class WorkspaceSchema
{
    internal static void ConfigureWorkspace(ModelBuilder modelBuilder)
    {
        var workspace = modelBuilder.Entity<Workspace>();
        workspace.ToTable("workspaces");
        workspace.Ignore(value => value.Id);
        workspace.HasKey("_id");

        workspace.Property<string>("_id")
            .HasColumnName("workspace_id")
            .HasMaxLength(64)
            .IsRequired();

        workspace.Ignore(value => value.TenantId);
        workspace.Property<string>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();

        workspace.Property(value => value.DisplayName)
            .HasConversion(
                value => value.Value,
                value => WorkspaceDisplayName.FromStorage(value))
            .HasColumnName("display_name")
            .HasMaxLength(200)
            .IsRequired();

        workspace.Property(value => value.Lifecycle)
            .HasConversion(
                value => WorkspaceLifecycleStorage.ToStorage(value),
                value => WorkspaceLifecycleStorage.FromStorage(value))
            .HasColumnName("lifecycle_state")
            .IsRequired();

        workspace.Property(value => value.Revision)
            .HasConversion(
                value => value.Value,
                value => WorkspaceRevision.FromStorage(value))
            .HasColumnName("revision")
            .IsConcurrencyToken()
            .IsRequired();

        workspace.Property(value => value.ProvisioningGeneration)
            .HasConversion(
                value => value.Value,
                value => WorkspaceProvisioningGeneration.FromStorage(value))
            .HasColumnName("provisioning_generation")
            .IsRequired();

        workspace.Property(value => value.CreatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("created_at_unix_ms")
            .IsRequired();

        workspace.Property(value => value.UpdatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("updated_at_unix_ms")
            .IsRequired();

        workspace.HasIndex("_tenantId");

        workspace.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey("_tenantId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
