using Microsoft.EntityFrameworkCore;
using CtlFlow.Tenancy.Tenantd.Db.Resources;

namespace CtlFlow.Tenancy.Tenantd.Db.AuditOutbox;

internal static class AuditOutboxSchema
{
    internal static void ConfigureAuditOutboxEntry(ModelBuilder modelBuilder)
    {
        var entry = modelBuilder.Entity<AuditOutboxEntry>();
        entry.ToTable("audit_outbox");
        entry.HasKey(value => value.OutboxId);
        entry.Property(value => value.OutboxId)
            .HasColumnName("outbox_id")
            .HasMaxLength(64);
        entry.Property(value => value.SourceEventId)
            .HasColumnName("source_event_id")
            .HasMaxLength(64);
        entry.Property(value => value.SourceSequence)
            .HasColumnName("source_sequence");
        entry.Property(value => value.OperatorSubject)
            .HasColumnName("operator_subject")
            .HasMaxLength(253);
        entry.Property(value => value.ImmediateCaller)
            .HasColumnName("immediate_caller")
            .HasMaxLength(253);
        entry.Property(value => value.OperationName)
            .HasColumnName("operation_name")
            .HasMaxLength(64);
        entry.Property(value => value.ResourceKind)
            .HasColumnName("resource_kind");
        entry.Property(value => value.TenantId)
            .HasColumnName("tenant_id")
            .HasMaxLength(64);
        entry.Property(value => value.WorkspaceId)
            .HasColumnName("workspace_id")
            .HasMaxLength(64);
        entry.Property(value => value.ResourceId)
            .HasColumnName("resource_id")
            .HasMaxLength(64);
        entry.Property(value => value.ResourceRevision)
            .HasColumnName("resource_revision");
        entry.Property(value => value.IdempotencyKey)
            .HasColumnName("idempotency_key")
            .HasMaxLength(128);
        entry.Property(value => value.OccurredAtUnixMilliseconds)
            .HasColumnName("occurred_at_unix_ms");
        entry.Property(value => value.TraceId)
            .HasColumnName("trace_id")
            .HasMaxLength(32);
        entry.Property(value => value.SpanId)
            .HasColumnName("span_id")
            .HasMaxLength(16);
        entry.Property(value => value.DeliveryState)
            .HasColumnName("delivery_state");
        entry.Property(value => value.DeliveryAttempts)
            .HasColumnName("delivery_attempts");
        entry.Property(value => value.Revision)
            .HasColumnName("revision")
            .IsConcurrencyToken();
        entry.Property(value => value.AvailableAtUnixMilliseconds)
            .HasColumnName("available_at_unix_ms");
        entry.Property(value => value.LeaseId)
            .HasColumnName("lease_id")
            .HasMaxLength(64);
        entry.Property(value => value.LeaseExpiresAtUnixMilliseconds)
            .HasColumnName("lease_expires_at_unix_ms");
        entry.Property(value => value.FailureCode)
            .HasColumnName("failure_code");
        entry.HasIndex(value => new
        {
            value.DeliveryState,
            value.AvailableAtUnixMilliseconds,
            value.SourceSequence
        });
        entry.HasIndex(value => value.SourceEventId).IsUnique();
        entry.HasIndex(value => value.SourceSequence).IsUnique();
        entry.HasOne<ResourceEvent>()
            .WithOne()
            .HasForeignKey<AuditOutboxEntry>(
                value => value.SourceSequence)
            .OnDelete(DeleteBehavior.Restrict);
    }

    internal static void ConfigureAuditOutboxState(ModelBuilder modelBuilder)
    {
        var state = modelBuilder.Entity<AuditOutboxState>();
        state.ToTable("audit_outbox_state");
        state.HasKey(value => value.StateId);
        state.Property(value => value.StateId)
            .HasColumnName("state_id");
        state.Property(value => value.MaximumPending)
            .HasColumnName("maximum_pending");
        state.Property(value => value.PendingCount)
            .HasColumnName("pending_count");
        state.Property(value => value.PermanentlyBlocked)
            .HasColumnName("permanently_blocked");
        state.Property(value => value.Revision)
            .HasColumnName("revision")
            .IsConcurrencyToken();
    }
}
