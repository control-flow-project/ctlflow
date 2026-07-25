using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

internal static partial class TenantSchema
{
    internal static void ConfigureTenant(ModelBuilder modelBuilder)
    {
        var tenant = modelBuilder.Entity<Tenant>();
        tenant.ToTable("tenants");
        tenant.Ignore(value => value.Id);
        tenant.HasKey("_id");

        tenant.Property<string>("_id")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();

        tenant.Property(value => value.DisplayName)
            .HasConversion(
                value => value.Value,
                value => TenantDisplayName.FromStorage(value))
            .HasColumnName("display_name")
            .HasMaxLength(200)
            .IsRequired();

        tenant.Property(value => value.Lifecycle)
            .HasConversion(
                value => LifecycleStates.ToStorage(value),
                value => LifecycleStates.FromStorage(value))
            .HasColumnName("lifecycle_state")
            .IsRequired();

        tenant.Property(value => value.Revision)
            .HasConversion(
                value => value.Value,
                value => TenantRevision.FromStorage(value))
            .HasColumnName("revision")
            .IsConcurrencyToken()
            .IsRequired();

        tenant.Property(value => value.ProvisioningGeneration)
            .HasConversion(
                value => value.Value,
                value => TenantProvisioningGeneration.FromStorage(value))
            .HasColumnName("provisioning_generation")
            .IsRequired();

        tenant.Ignore(value => value.CurrentOperationId);
        tenant.Property<string?>("_currentOperationId")
            .HasColumnName("current_operation_id")
            .HasMaxLength(64);

        tenant.Property(value => value.LastEventSequence)
            .HasConversion(
                value => value.Value,
                value => ResourceEventSequence.FromStorage(value))
            .HasColumnName("last_event_sequence")
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
    }
}
