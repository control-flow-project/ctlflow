using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal static partial class LifecycleSchema
{
    internal static void ConfigureLifecycleStep(ModelBuilder modelBuilder)
    {
        var step = modelBuilder.Entity<LifecycleStep>();
        step.ToTable("lifecycle_steps");
        step.Ignore(value => value.OperationId);
        step.HasKey("_operationId", "Key");

        step.Property<string>("_operationId")
            .HasColumnName("operation_id")
            .HasMaxLength(64);
        step.Property(value => value.Key)
            .HasConversion(
                value => LifecycleStepKeys.ToStorage(value),
                value => LifecycleStepKeys.FromStorage(value))
            .HasColumnName("step_key");
        step.Property(value => value.State)
            .HasConversion(
                value => LifecycleStepStates.ToStorage(value),
                value => LifecycleStepStates.FromStorage(value))
            .HasColumnName("step_state");
        step.Property(value => value.Revision)
            .HasConversion(
                value => value.Value,
                value => LifecycleStepRevision.FromStorage(value))
            .HasColumnName("revision")
            .IsConcurrencyToken();
        step.Ignore(value => value.DeliverySequence);
        step.Property<long>("_deliverySequence")
            .HasColumnName("delivery_sequence");
        step.Property(value => value.OwnerRevision)
            .HasConversion(
                value => value!.Value,
                value => LifecycleOwnerRevision.FromStorage(value))
            .HasColumnName("owner_revision");
        step.Property(value => value.BlockedReason)
            .HasConversion(
                value => value!.Value,
                value => BlockedReason.FromStorage(value))
            .HasColumnName("blocked_reason")
            .HasMaxLength(200);
        step.Property(value => value.UpdatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("updated_at_unix_ms");

        step.HasIndex("Key", "State", "_deliverySequence");
        step.HasOne<LifecycleOperation>()
            .WithMany()
            .HasForeignKey("_operationId")
            .HasPrincipalKey("_operationId")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
