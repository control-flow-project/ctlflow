using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Requests;

internal static class RequestSchema
{
    internal static void ConfigureIdempotencyRecord(ModelBuilder modelBuilder)
    {
        var record = modelBuilder.Entity<IdempotencyRecord>();
        record.ToTable("idempotency_records");
        record.HasKey(value => value.RecordId);
        record.Property(value => value.RecordId)
            .HasColumnName("idempotency_record_id")
            .HasMaxLength(64);
        record.Property(value => value.RequestActor)
            .HasColumnName("request_actor")
            .HasMaxLength(253);
        record.Property(value => value.OperationName)
            .HasColumnName("operation_name")
            .HasMaxLength(64);
        record.Property(value => value.IdempotencyKey)
            .HasColumnName("idempotency_key")
            .HasMaxLength(128);
        record.Property(value => value.RequestHash)
            .HasColumnName("request_hash")
            .HasMaxLength(64);
        record.Property(value => value.ResourceKind)
            .HasColumnName("resource_kind");
        record.Property(value => value.ResourceId)
            .HasColumnName("resource_id")
            .HasMaxLength(64);
        record.Property(value => value.LifecycleOperationId)
            .HasColumnName("lifecycle_operation_id")
            .HasMaxLength(64);
        record.Property(value => value.ResultResourceRevision)
            .HasColumnName("result_resource_revision");
        record.Property(value => value.ResultLifecycleState)
            .HasColumnName("result_lifecycle_state");
        record.Property(value => value.ResultProvisioningGeneration)
            .HasColumnName("result_provisioning_generation");
        record.Property(value => value.ResultStepRevision)
            .HasColumnName("result_step_revision");
        record.Property(value => value.ResultStepState)
            .HasColumnName("result_step_state");
        record.Property(value => value.ResultEventSequence)
            .HasColumnName("result_event_sequence");
        record.Property(value => value.CreatedAtUnixMilliseconds)
            .HasColumnName("created_at_unix_ms");
        record.HasIndex(value => new
        {
            value.RequestActor,
            value.OperationName,
            value.IdempotencyKey
        }).IsUnique();
    }
}
