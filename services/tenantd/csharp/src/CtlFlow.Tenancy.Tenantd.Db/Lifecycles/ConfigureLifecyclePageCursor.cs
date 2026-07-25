using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal static partial class LifecycleSchema
{
    internal static void ConfigureLifecyclePageCursor(
        ModelBuilder modelBuilder)
    {
        var cursor = modelBuilder.Entity<LifecyclePageCursor>();
        cursor.ToTable("lifecycle_page_cursors");
        cursor.HasKey(value => value.PageToken);
        cursor.Property(value => value.PageToken)
            .HasColumnName("page_token")
            .HasMaxLength(128);
        cursor.Property(value => value.StepKey)
            .HasColumnName("step_key");
        cursor.Property(value => value.RequestActor)
            .HasColumnName("request_actor")
            .HasMaxLength(253);
        cursor.Property(value => value.LastDeliverySequence)
            .HasColumnName("last_delivery_sequence");
        cursor.Property(value => value.SnapshotSequence)
            .HasColumnName("snapshot_sequence");
        cursor.Property(value => value.ExpiresAtUnixMilliseconds)
            .HasColumnName("expires_at_unix_ms");
        cursor.HasIndex(value => value.ExpiresAtUnixMilliseconds);
    }
}
