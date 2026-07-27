using CtlFlow.Audit.Auditd.Domain.Partitions;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Audit.Auditd.Db.Events;

internal static partial class AuditEventSchema
{
    internal static void ConfigureAuditPartitionHead(ModelBuilder modelBuilder)
    {
        var head = modelBuilder.Entity<AuditPartitionHead>();
        head.ToTable("audit_partition_heads");
        head.HasKey(value => value.PartitionKey);
        head.Property(value => value.PartitionKey)
            .HasColumnName("partition_key")
            .HasMaxLength(71)
            .IsRequired();
        head.Property(value => value.PartitionKind)
            .HasColumnName("partition_kind")
            .IsRequired();
        head.Property(value => value.TenantId)
            .HasColumnName("tenant_id")
            .HasMaxLength(64);
        head.Property(value => value.CurrentCursor)
            .HasColumnName("current_cursor")
            .IsConcurrencyToken()
            .IsRequired();
    }
}
