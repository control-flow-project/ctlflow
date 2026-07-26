using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Resources.ResourceStates;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

internal static partial class TenantSchema
{
    internal static void ConfigureTenant(ModelBuilder modelBuilder)
    {
        var tenant = modelBuilder.Entity<Tenant>();
        tenant.ToTable("tenants");
        tenant.Ignore(value => value.Id);
        tenant.Ignore(value => value.Address);
        tenant.HasKey("_id");

        tenant.Property<string>("_id")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();
        tenant.Property<string>("_address")
            .HasColumnName("address")
            .HasMaxLength(63)
            .IsRequired();
        tenant.Property(value => value.DisplayName)
            .HasConversion(
                value => value.Value,
                value => DisplayName.FromStorage(value))
            .HasColumnName("display_name")
            .HasMaxLength(200)
            .IsRequired();
        tenant.Property(value => value.State)
            .HasConversion(
                value => ToStorage(value),
                value => FromStorage(value))
            .HasColumnName("state")
            .IsRequired();
        tenant.Property(value => value.Revision)
            .HasConversion(
                value => value.Value,
                value => Revision.FromStorage(value))
            .HasColumnName("revision")
            .IsConcurrencyToken()
            .IsRequired();
        tenant.Property(value => value.CreatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("created_at_unix_ms")
            .IsRequired();
        tenant.Property(value => value.UpdatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("updated_at_unix_ms")
            .IsRequired();

        tenant.HasIndex("_address").IsUnique();
    }
}
