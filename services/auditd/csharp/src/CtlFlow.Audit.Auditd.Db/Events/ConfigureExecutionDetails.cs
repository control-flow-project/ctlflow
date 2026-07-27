using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Audit.Auditd.Db.Events;

internal static partial class AuditEventSchema
{
    internal static void ConfigurePlacementMutation(ModelBuilder modelBuilder)
    {
        var detail = modelBuilder.Entity<PlacementMutationAuditDetail>();
        detail.ToTable("audit_placement_mutations");
        detail.HasKey(value => value.EventKey);
        detail.Ignore(value => value.Kind);
        detail.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        detail.HasOne<AuditRecord>()
            .WithOne()
            .HasForeignKey<PlacementMutationAuditDetail>(
                value => value.EventKey)
            .OnDelete(DeleteBehavior.Restrict);
        detail.Ignore(value => value.Target);
        detail.Property(value => value.PlacementId)
            .HasColumnName("placement_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.TargetKind)
            .HasConversion<int>()
            .HasColumnName("target_kind")
            .IsRequired();
        detail.Property(value => value.TargetTenantId)
            .HasColumnName("target_tenant_id")
            .HasMaxLength(64);
        detail.Property(value => value.TargetWorkspaceId)
            .HasColumnName("target_workspace_id")
            .HasMaxLength(64);
        detail.Property(value => value.TargetAccountPrincipalId)
            .HasColumnName("target_account_principal_id")
            .HasMaxLength(256);
        detail.Property(value => value.Action)
            .HasColumnName("action")
            .IsRequired();
        detail.Property(value => value.PlacementRevision)
            .HasColumnName("placement_revision")
            .IsRequired();
        detail.Property(value => value.ResultingDesiredState)
            .HasColumnName("resulting_desired_state")
            .IsRequired();
    }

    internal static void ConfigureWorkloadMutation(ModelBuilder modelBuilder)
    {
        var detail = modelBuilder.Entity<WorkloadMutationAuditDetail>();
        detail.ToTable("audit_workload_mutations");
        detail.HasKey(value => value.EventKey);
        detail.Ignore(value => value.Kind);
        detail.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        detail.HasOne<AuditRecord>()
            .WithOne()
            .HasForeignKey<WorkloadMutationAuditDetail>(
                value => value.EventKey)
            .OnDelete(DeleteBehavior.Restrict);
        detail.Ignore(value => value.PlacementTarget);
        detail.Property(value => value.WorkloadId)
            .HasColumnName("workload_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.PlacementId)
            .HasColumnName("placement_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.TargetKind)
            .HasConversion<int>()
            .HasColumnName("placement_target_kind")
            .IsRequired();
        detail.Property(value => value.TargetTenantId)
            .HasColumnName("placement_target_tenant_id")
            .HasMaxLength(64);
        detail.Property(value => value.TargetWorkspaceId)
            .HasColumnName("placement_target_workspace_id")
            .HasMaxLength(64);
        detail.Property(value => value.TargetAccountPrincipalId)
            .HasColumnName("placement_target_account_principal_id")
            .HasMaxLength(256);
        detail.Property(value => value.Action)
            .HasColumnName("action")
            .IsRequired();
        detail.Property(value => value.WorkloadRevision)
            .HasColumnName("workload_revision")
            .IsRequired();
        detail.Property(value => value.ResultingDesiredState)
            .HasColumnName("resulting_desired_state")
            .IsRequired();
        detail.Property(value => value.AppId)
            .HasColumnName("app_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.AppRevision)
            .HasColumnName("app_revision")
            .IsRequired();
        detail.Property(value => value.PackageId)
            .HasColumnName("package_id")
            .HasMaxLength(128)
            .IsRequired();
        detail.Property(value => value.PackageGeneration)
            .HasColumnName("package_generation")
            .IsRequired();
        detail.Property(value => value.ComponentId)
            .HasColumnName("component_id")
            .HasMaxLength(64)
            .IsRequired();
    }

    internal static void ConfigureRunMutation(ModelBuilder modelBuilder)
    {
        var detail = modelBuilder.Entity<RunMutationAuditDetail>();
        detail.ToTable("audit_run_mutations");
        detail.HasKey(value => value.EventKey);
        detail.Ignore(value => value.Kind);
        detail.Property(value => value.EventKey)
            .HasColumnName("event_key")
            .HasMaxLength(64)
            .IsRequired();
        detail.HasOne<AuditRecord>()
            .WithOne()
            .HasForeignKey<RunMutationAuditDetail>(
                value => value.EventKey)
            .OnDelete(DeleteBehavior.Restrict);
        detail.Ignore(value => value.PlacementTarget);
        detail.Property(value => value.RunId)
            .HasColumnName("run_id")
            .HasMaxLength(128)
            .IsRequired();
        detail.Property(value => value.WorkloadId)
            .HasColumnName("workload_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.PlacementId)
            .HasColumnName("placement_id")
            .HasMaxLength(64)
            .IsRequired();
        detail.Property(value => value.TargetKind)
            .HasConversion<int>()
            .HasColumnName("placement_target_kind")
            .IsRequired();
        detail.Property(value => value.TargetTenantId)
            .HasColumnName("placement_target_tenant_id")
            .HasMaxLength(64);
        detail.Property(value => value.TargetWorkspaceId)
            .HasColumnName("placement_target_workspace_id")
            .HasMaxLength(64);
        detail.Property(value => value.TargetAccountPrincipalId)
            .HasColumnName("placement_target_account_principal_id")
            .HasMaxLength(256);
        detail.Property(value => value.Action)
            .HasColumnName("action")
            .IsRequired();
        detail.Property(value => value.RunRevision)
            .HasColumnName("run_revision")
            .IsRequired();
        detail.Property(value => value.ConfiguredActorPrincipalId)
            .HasColumnName("configured_actor_principal_id")
            .HasMaxLength(256);
    }
}
