using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Resources;

internal static partial class ResourceSchema
{
    internal static void ConfigureResourceEventCondition(
        ModelBuilder modelBuilder)
    {
        var condition = modelBuilder.Entity<ResourceEventCondition>();
        condition.ToTable("resource_event_conditions");
        condition.HasKey(
            value => new
            {
                value.EventSequence,
                value.StepKey
            });
        condition.Property(value => value.EventSequence)
            .HasColumnName("event_sequence");
        condition.Property(value => value.StepKey)
            .HasColumnName("step_key");
        condition.Property(value => value.StepState)
            .HasColumnName("step_state");
        condition.Property(value => value.OwnerRevision)
            .HasColumnName("owner_revision");
        condition.Property(value => value.BlockedReason)
            .HasColumnName("blocked_reason")
            .HasMaxLength(200);
        condition.Property(value => value.UpdatedAtUnixMilliseconds)
            .HasColumnName("updated_at_unix_ms");
        condition.HasOne<ResourceEvent>()
            .WithMany()
            .HasForeignKey(value => value.EventSequence)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
