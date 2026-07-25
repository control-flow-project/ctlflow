using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Resources;

internal static partial class ResourceSchema
{
    internal static void ConfigurePageCursor(ModelBuilder modelBuilder)
    {
        var cursor = modelBuilder.Entity<PageCursor>();
        cursor.ToTable("page_cursors");
        cursor.HasKey(value => value.PageToken);
        cursor.Property(value => value.PageToken)
            .HasColumnName("page_token")
            .HasMaxLength(128);
        cursor.Property(value => value.ResourceKind)
            .HasColumnName("resource_kind");
        cursor.Property(value => value.RequestActor)
            .HasColumnName("request_actor")
            .HasMaxLength(253);
        cursor.Property(value => value.VisibilityHash)
            .HasColumnName("visibility_hash")
            .HasMaxLength(64);
        cursor.Property(value => value.TenantFilter)
            .HasColumnName("tenant_filter")
            .HasMaxLength(64);
        cursor.Property(value => value.LastResourceId)
            .HasColumnName("last_resource_id")
            .HasMaxLength(64);
        cursor.Property(value => value.SnapshotSequence)
            .HasColumnName("snapshot_sequence");
        cursor.Property(value => value.ExpiresAtUnixMilliseconds)
            .HasColumnName("expires_at_unix_ms");
        cursor.HasIndex(value => value.ExpiresAtUnixMilliseconds);
    }
}
