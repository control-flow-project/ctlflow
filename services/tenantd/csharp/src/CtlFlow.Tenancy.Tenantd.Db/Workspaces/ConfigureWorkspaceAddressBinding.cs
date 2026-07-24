using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

internal static partial class WorkspaceAddressBindingSchema
{
    internal static void ConfigureWorkspaceAddressBinding(ModelBuilder modelBuilder)
    {
        var binding = modelBuilder.Entity<WorkspaceAddressBinding>();
        binding.ToTable("workspace_address_bindings");
        binding.HasKey(value => value.Id);

        binding.Property(value => value.Id)
            .HasConversion(
                value => value.Value,
                value => WorkspaceAddressBindingId.FromStorage(value))
            .HasColumnName("address_binding_id")
            .HasMaxLength(64);

        binding.Ignore(value => value.TenantId);
        binding.Property<string>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();

        binding.Ignore(value => value.WorkspaceId);
        binding.Property<string>("_workspaceId")
            .HasColumnName("workspace_id")
            .HasMaxLength(64)
            .IsRequired();

        binding.Ignore(value => value.WorkspaceAddress);
        binding.Property<string>("_workspaceAddress")
            .HasColumnName("workspace_address")
            .HasMaxLength(63)
            .IsRequired();

        binding.Property(value => value.BindingGeneration)
            .HasConversion(
                value => value.Value,
                value => AddressBindingGeneration.FromStorage(value))
            .HasColumnName("binding_generation")
            .IsRequired();

        binding.Property(value => value.IsActive)
            .HasColumnName("is_active")
            .IsRequired();

        binding.Property(value => value.CreatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("created_at_unix_ms")
            .IsRequired();

        binding.Property(value => value.UpdatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("updated_at_unix_ms")
            .IsRequired();

        binding.HasIndex("_tenantId", "_workspaceAddress")
            .IsUnique();
        binding.HasIndex("_workspaceId");

        binding.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey("_tenantId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);

        binding.HasOne<Workspace>()
            .WithMany()
            .HasForeignKey("_workspaceId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
