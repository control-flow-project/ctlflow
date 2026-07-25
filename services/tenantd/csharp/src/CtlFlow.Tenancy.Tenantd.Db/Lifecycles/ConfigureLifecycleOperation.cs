using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal static partial class LifecycleSchema
{
    internal static void ConfigureLifecycleOperation(ModelBuilder modelBuilder)
    {
        var operation = modelBuilder.Entity<LifecycleOperation>();
        operation.ToTable("lifecycle_operations");
        operation.Ignore(value => value.Id);
        operation.Ignore(value => value.Target);
        operation.HasKey("_operationId");

        operation.Property<string>("_operationId")
            .HasColumnName("operation_id")
            .HasMaxLength(64);
        operation.Property<int>("TargetKind")
            .HasColumnName("target_kind");
        operation.Property<string>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64);
        operation.Property<string?>("_workspaceId")
            .HasColumnName("workspace_id")
            .HasMaxLength(64);
        operation.Property(value => value.Kind)
            .HasConversion(
                value => LifecycleOperationKinds.ToStorage(value),
                value => LifecycleOperationKinds.FromStorage(value))
            .HasColumnName("operation_kind");
        operation.Property(value => value.DesiredLifecycle)
            .HasConversion(
                value => LifecycleStates.ToStorage(value),
                value => LifecycleStates.FromStorage(value))
            .HasColumnName("desired_lifecycle_state");
        operation.Property(value => value.ProvisioningGeneration)
            .HasColumnName("provisioning_generation");
        operation.Property(value => value.State)
            .HasConversion(
                value => LifecycleOperationStates.ToStorage(value),
                value => LifecycleOperationStates.FromStorage(value))
            .HasColumnName("operation_state");
        operation.Property(value => value.RequestActor)
            .HasConversion(
                value => value.Value,
                value => RequestActor.FromStorage(value))
            .HasColumnName("request_actor")
            .HasMaxLength(253);
        operation.Property(value => value.IdempotencyKey)
            .HasConversion(
                value => value.Value,
                value => IdempotencyKey.FromStorage(value))
            .HasColumnName("idempotency_key")
            .HasMaxLength(128);
        operation.Property(value => value.RequestDigest)
            .HasConversion(
                value => value.Value,
                value => RequestDigest.FromStorage(value))
            .HasColumnName("request_hash")
            .HasMaxLength(64);
        operation.Property(value => value.CreatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("created_at_unix_ms");
        operation.Property(value => value.UpdatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("updated_at_unix_ms");

        operation.HasIndex(
                "RequestActor",
                "Kind",
                "IdempotencyKey")
            .IsUnique();
        operation.HasIndex(
            "_tenantId",
            "_workspaceId",
            "State");
        operation.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey("_tenantId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
        operation.HasOne<Workspace>()
            .WithMany()
            .HasForeignKey("_workspaceId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
