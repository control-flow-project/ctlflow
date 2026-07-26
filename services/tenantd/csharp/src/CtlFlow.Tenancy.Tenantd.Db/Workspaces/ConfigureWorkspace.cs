using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Resources.ResourceStates;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

internal static partial class WorkspaceSchema
{
    internal static void ConfigureWorkspace(ModelBuilder modelBuilder)
    {
        var workspace = modelBuilder.Entity<Workspace>();
        workspace.ToTable("workspaces");
        workspace.Ignore(value => value.Id);
        workspace.Ignore(value => value.TenantId);
        workspace.Ignore(value => value.Address);
        workspace.HasKey("_id");

        workspace.Property<string>("_id")
            .HasColumnName("workspace_id")
            .HasMaxLength(64)
            .IsRequired();
        workspace.Property<string>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();
        workspace.Property<string>("_address")
            .HasColumnName("address")
            .HasMaxLength(63)
            .IsRequired();
        workspace.Property(value => value.DisplayName)
            .HasConversion(
                value => value.Value,
                value => DisplayName.FromStorage(value))
            .HasColumnName("display_name")
            .HasMaxLength(200)
            .IsRequired();
        workspace.Property(value => value.State)
            .HasConversion(
                value => ToStorage(value),
                value => FromStorage(value))
            .HasColumnName("state")
            .IsRequired();
        workspace.Property(value => value.Revision)
            .HasConversion(
                value => value.Value,
                value => Revision.FromStorage(value))
            .HasColumnName("revision")
            .IsConcurrencyToken()
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

        workspace.HasIndex("_tenantId", "_address")
            .IsUnique();
        workspace.HasIndex("_tenantId", "_id");
        workspace.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey("_tenantId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
