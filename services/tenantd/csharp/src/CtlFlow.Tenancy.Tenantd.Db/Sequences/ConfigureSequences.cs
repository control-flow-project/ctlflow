using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Sequences;

internal static class SequenceSchema
{
    internal static void ConfigureSequences(ModelBuilder modelBuilder)
    {
        var delivery = modelBuilder.Entity<LifecycleDeliverySequenceState>();
        delivery.ToTable("lifecycle_delivery_sequences");
        delivery.HasKey(value => value.SequenceId);
        delivery.Property(value => value.SequenceId)
            .HasColumnName("sequence_id")
            .ValueGeneratedNever();
        delivery.Property(value => value.CurrentSequence)
            .HasColumnName("current_sequence")
            .IsConcurrencyToken();

        var resource = modelBuilder.Entity<ResourceEventSequenceState>();
        resource.ToTable("resource_event_sequences");
        resource.HasKey(value => value.SequenceId);
        resource.Property(value => value.SequenceId)
            .HasColumnName("sequence_id")
            .ValueGeneratedNever();
        resource.Property(value => value.CurrentSequence)
            .HasColumnName("current_sequence")
            .IsConcurrencyToken();
        resource.Property(value => value.RetainedFromSequence)
            .HasColumnName("retained_from_sequence");
    }
}
