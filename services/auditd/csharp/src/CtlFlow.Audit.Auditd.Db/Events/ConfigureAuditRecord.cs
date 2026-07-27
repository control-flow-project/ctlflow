using CtlFlow.Audit.Auditd.Domain.Events;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Audit.Auditd.Db.Events;

internal static partial class AuditEventSchema
{
    internal static void ConfigureAuditRecord(ModelBuilder modelBuilder)
    {
        var record = modelBuilder.Entity<AuditRecord>();
        record.ToTable("audit_events");
        record.HasKey(value => value.EventKey);
        record.Ignore(value => value.Source);
        record.Ignore(value => value.Detail);

        record.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        record.Property(value => value.SourcePrincipal)
            .HasColumnName("source_principal")
            .HasMaxLength(32)
            .IsRequired();
        record.Property(value => value.SourceSubject)
            .HasColumnName("source_subject")
            .HasMaxLength(149)
            .IsRequired();
        record.Property(value => value.SourceEventId)
            .HasColumnName("source_event_id")
            .HasMaxLength(36)
            .IsRequired();
        record.Property(value => value.OccurredAtSeconds)
            .HasColumnName("occurred_at_seconds")
            .IsRequired();
        record.Property(value => value.OccurredAtNanoseconds)
            .HasColumnName("occurred_at_nanoseconds")
            .IsRequired();
        record.Property(value => value.AttributionKind)
            .HasConversion<int>()
            .HasColumnName("attribution_kind")
            .IsRequired();
        record.Property(value => value.OperatorCommonName)
            .HasColumnName("operator_common_name")
            .HasMaxLength(253);
        record.Property(value => value.WorkloadSubject)
            .HasColumnName("workload_subject")
            .HasMaxLength(149);
        record.Property(value => value.ActorPrincipalId)
            .HasColumnName("actor_principal_id")
            .HasMaxLength(256);
        record.Property(value => value.AttachedAccountPrincipalId)
            .HasColumnName("attached_account_principal_id")
            .HasMaxLength(256);
        record.Property(value => value.InvocationWorkloadSubject)
            .HasColumnName("invocation_workload_subject")
            .HasMaxLength(149);
        record.Property(value => value.PartitionKind)
            .HasConversion<int>()
            .HasColumnName("partition_kind")
            .IsRequired();
        record.Property(value => value.PartitionTenantId)
            .HasColumnName("partition_tenant_id")
            .HasMaxLength(64);
        record.Property(value => value.PartitionKey)
            .HasColumnName("partition_key")
            .HasMaxLength(71)
            .IsRequired();
        record.Property(value => value.TraceId)
            .HasColumnName("trace_id")
            .HasMaxLength(32)
            .IsRequired();
        record.Property(value => value.SpanId)
            .HasColumnName("span_id")
            .HasMaxLength(16)
            .IsRequired();
        record.Property(value => value.DetailKind)
            .HasConversion<int>()
            .HasColumnName("detail_kind")
            .IsRequired();
        record.Property(value => value.ContentHash)
            .HasColumnName("content_hash")
            .HasMaxLength(64)
            .IsRequired();
        record.Property(value => value.AcceptedAtSeconds)
            .HasColumnName("accepted_at_seconds")
            .IsRequired();
        record.Property(value => value.AcceptedAtNanoseconds)
            .HasColumnName("accepted_at_nanoseconds")
            .IsRequired();
        record.Property(value => value.PartitionCursor)
            .HasColumnName("partition_cursor")
            .IsRequired();

        record.HasIndex(
                value => new
                {
                    value.SourcePrincipal,
                    value.SourceEventId
                })
            .IsUnique();
        record.HasIndex(
                value => new
                {
                    value.PartitionKey,
                    value.PartitionCursor
                })
            .IsUnique();
    }
}
