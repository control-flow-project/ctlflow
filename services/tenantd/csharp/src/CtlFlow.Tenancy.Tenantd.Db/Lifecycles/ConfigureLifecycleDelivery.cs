using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal static partial class LifecycleSchema
{
    internal static void ConfigureLifecycleDelivery(ModelBuilder modelBuilder)
    {
        var delivery = modelBuilder.Entity<LifecycleDelivery>();
        delivery.ToTable("lifecycle_deliveries");
        delivery.HasKey(value => value.DeliverySequence);
        delivery.Property(value => value.DeliverySequence)
            .HasColumnName("delivery_sequence")
            .ValueGeneratedNever();
        delivery.Property(value => value.OperationId)
            .HasColumnName("operation_id")
            .HasMaxLength(64);
        delivery.Property(value => value.StepKey)
            .HasConversion(
                value => LifecycleStepKeys.ToStorage(value),
                value => LifecycleStepKeys.FromStorage(value))
            .HasColumnName("step_key");
        delivery.Property(value => value.StepRevision)
            .HasColumnName("step_revision");
        delivery.Property(value => value.CreatedAtUnixMilliseconds)
            .HasColumnName("created_at_unix_ms");
        delivery.HasIndex(value => new
        {
            value.StepKey,
            value.DeliverySequence
        });
        delivery.HasOne(value => value.Step)
            .WithMany()
            .HasForeignKey(
                value => new
                {
                    value.OperationId,
                    value.StepKey
                })
            .HasPrincipalKey("_operationId", "Key")
            .OnDelete(DeleteBehavior.Restrict);
        delivery.HasOne(value => value.Operation)
            .WithMany()
            .HasForeignKey(value => value.OperationId)
            .HasPrincipalKey("_operationId")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
