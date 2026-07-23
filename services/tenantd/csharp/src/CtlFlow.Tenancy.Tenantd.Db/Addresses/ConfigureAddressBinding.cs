using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Addresses;

internal static partial class AddressBindingSchema
{
    internal static void ConfigureAddressBinding(ModelBuilder modelBuilder)
    {
        var address = modelBuilder.Entity<TenantAddressBinding>();
        address.ToTable("tenant_address_bindings");
        address.HasKey(value => value.Id);

        address.Property(value => value.Id)
            .HasConversion(
                value => value.Value,
                value => TenantAddressBindingId.FromStorage(value))
            .HasColumnName("address_binding_id")
            .HasMaxLength(64);

        address.Ignore(value => value.TenantId);
        address.Property<string>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();

        address.Ignore(value => value.Authority);
        address.Property<string>("_authority")
            .HasColumnName("authority")
            .HasMaxLength(253)
            .IsRequired();

        address.Ignore(value => value.PathPrefix);
        address.Property<string>("_pathPrefix")
            .HasColumnName("path_prefix")
            .HasMaxLength(72)
            .IsRequired();

        address.Property(value => value.BindingGeneration)
            .HasConversion(
                value => value.Value,
                value => AddressBindingGeneration.FromStorage(value))
            .HasColumnName("binding_generation")
            .IsRequired();

        address.Property(value => value.IsActive)
            .HasColumnName("is_active")
            .IsRequired();

        address.Property(value => value.CreatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("created_at_unix_ms")
            .IsRequired();

        address.Property(value => value.UpdatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("updated_at_unix_ms")
            .IsRequired();

        address.HasIndex("_authority", "_pathPrefix")
            .IsUnique();
        address.HasIndex("_tenantId");

        address.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey("_tenantId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
