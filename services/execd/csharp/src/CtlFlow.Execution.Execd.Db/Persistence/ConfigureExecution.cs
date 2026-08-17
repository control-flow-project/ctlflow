using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Domain.Storage;
using CtlFlow.Execution.Execd.Domain.Workloads;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Persistence;

internal static class ExecutionSchema
{
    internal static void ConfigureExecution(ModelBuilder modelBuilder)
    {
        ConfigurePlacements(modelBuilder);
        ConfigureWorkloads(modelBuilder);
        ConfigureRuns(modelBuilder);
    }

    private static void ConfigurePlacements(ModelBuilder modelBuilder)
    {
        var placement = modelBuilder.Entity<Placement>();
        placement.ToTable("placements");
        placement.HasKey(row => row.PlacementId);
        placement.Property(row => row.PlacementId).HasColumnName("placement_id").HasMaxLength(64).IsRequired();
        placement.Property(row => row.TargetKind).HasColumnName("target_kind").IsRequired();
        placement.Property(row => row.TenantId).HasColumnName("tenant_id").HasMaxLength(64);
        placement.Property(row => row.WorkspaceId).HasColumnName("workspace_id").HasMaxLength(64);
        placement.Property(row => row.AccountPrincipalId).HasColumnName("account_principal_id").HasMaxLength(256);
        placement.Property(row => row.ParentPlacementId).HasColumnName("parent_placement_id").HasMaxLength(64);
        placement.Property(row => row.DesiredState).HasColumnName("desired_state").IsRequired();
        placement.Property(row => row.AdmitContinuous).HasColumnName("admit_continuous").IsRequired();
        placement.Property(row => row.AdmitFinite).HasColumnName("admit_finite").IsRequired();
        placement.Property(row => row.MaxReplicas).HasColumnName("max_replicas").IsRequired();
        placement.Property(row => row.MaxRunDurationSeconds).HasColumnName("max_run_duration_seconds").IsRequired();
        placement.Property(row => row.MaxRunAttempts).HasColumnName("max_run_attempts").IsRequired();
        placement.Property(row => row.MaxCpuMillis).HasColumnName("max_cpu_millis").IsRequired();
        placement.Property(row => row.MaxMemoryBytes).HasColumnName("max_memory_bytes").IsRequired();
        placement.Property(row => row.MaxStorageBytes).HasColumnName("max_storage_bytes").IsRequired();
        placement.Property(row => row.Revision).HasColumnName("revision").IsConcurrencyToken().IsRequired();
        placement.Property(row => row.StatusRevision).HasColumnName("status_revision").IsRequired();
        placement.Property(row => row.ObservedRevision).HasColumnName("observed_revision").IsRequired();
        placement.Property(row => row.RealizationPhase).HasColumnName("realization_phase").IsRequired();
        placement.Property(row => row.RealizationReason).HasColumnName("realization_reason").IsRequired();
        placement.Property(row => row.CreatedAtUnixMs).HasColumnName("created_at_unix_ms").IsRequired();
        placement.Property(row => row.UpdatedAtUnixMs).HasColumnName("updated_at_unix_ms").IsRequired();
        placement.Property(row => row.StatusUpdatedAtUnixMs).HasColumnName("status_updated_at_unix_ms").IsRequired();
        placement.HasOne<Placement>().WithMany()
            .HasForeignKey(row => row.ParentPlacementId).OnDelete(DeleteBehavior.Restrict);
        placement.HasIndex(row => new
        {
            row.TargetKind,
            row.TenantId,
            row.WorkspaceId,
            row.AccountPrincipalId,
            row.PlacementId
        }).HasDatabaseName("placements_target_page_idx");
        placement.HasIndex(row => row.ParentPlacementId)
            .HasDatabaseName("placements_parent_idx");

        var provisioner = modelBuilder.Entity<PlacementProvisioner>();
        provisioner.ToTable("placement_provisioners");
        provisioner.HasKey(row => new { row.PlacementId, row.DependencyType });
        provisioner.Property(row => row.PlacementId).HasColumnName("placement_id").HasMaxLength(64).IsRequired();
        provisioner.Property(row => row.DependencyType).HasColumnName("dependency_type").HasMaxLength(128).IsRequired();
        provisioner.Property(row => row.ProvisionerId).HasColumnName("provisioner_id").HasMaxLength(64).IsRequired();
        provisioner.HasOne<Placement>().WithMany()
            .HasForeignKey(row => row.PlacementId).OnDelete(DeleteBehavior.Cascade);
    }

    private static void ConfigureWorkloads(ModelBuilder modelBuilder)
    {
        var workload = modelBuilder.Entity<Workload>();
        workload.ToTable("workloads");
        workload.HasKey(row => row.WorkloadId);
        workload.Property(row => row.WorkloadId).HasColumnName("workload_id").HasMaxLength(64).IsRequired();
        workload.Property(row => row.PlacementId).HasColumnName("placement_id").HasMaxLength(64).IsRequired();
        workload.Property(row => row.DesiredState).HasColumnName("desired_state").IsRequired();
        workload.Property(row => row.Mode).HasColumnName("mode").IsRequired();
        workload.Property(row => row.AppId).HasColumnName("app_id").HasMaxLength(64).IsRequired();
        workload.Property(row => row.AppRevision).HasColumnName("app_revision").IsRequired();
        workload.Property(row => row.PackageId).HasColumnName("package_id").HasMaxLength(128).IsRequired();
        workload.Property(row => row.PackageGeneration).HasColumnName("package_generation").IsRequired();
        workload.Property(row => row.ComponentId).HasColumnName("component_id").HasMaxLength(64).IsRequired();
        workload.Property(row => row.ServiceAccountSubject)
            .HasColumnName("service_account_subject")
            .HasMaxLength(512)
            .IsRequired();
        workload.HasIndex(row => row.ServiceAccountSubject)
            .IsUnique()
            .HasDatabaseName("workloads_service_account_subject_unique_idx");
        workload.Property(row => row.ArtifactRepository).HasColumnName("artifact_repository").HasMaxLength(255).IsRequired();
        workload.Property(row => row.ArtifactManifestDigest).HasColumnName("artifact_manifest_digest").HasMaxLength(71).IsRequired();
        workload.Property(row => row.CpuMillis).HasColumnName("cpu_millis").IsRequired();
        workload.Property(row => row.MemoryBytes).HasColumnName("memory_bytes").IsRequired();
        workload.Property(row => row.Replicas).HasColumnName("replicas");
        workload.Property(row => row.ActorPrincipalId).HasColumnName("actor_principal_id").HasMaxLength(256);
        workload.Property(row => row.RunDurationSeconds).HasColumnName("run_duration_seconds");
        workload.Property(row => row.MaxAttempts).HasColumnName("max_attempts");
        workload.Property(row => row.Revision).HasColumnName("revision").IsConcurrencyToken().IsRequired();
        workload.Property(row => row.StatusRevision).HasColumnName("status_revision").IsRequired();
        workload.Property(row => row.ObservedRevision).HasColumnName("observed_revision").IsRequired();
        workload.Property(row => row.RealizationPhase).HasColumnName("realization_phase").IsRequired();
        workload.Property(row => row.RealizationReason).HasColumnName("realization_reason").IsRequired();
        workload.Property(row => row.CreatedAtUnixMs).HasColumnName("created_at_unix_ms").IsRequired();
        workload.Property(row => row.UpdatedAtUnixMs).HasColumnName("updated_at_unix_ms").IsRequired();
        workload.Property(row => row.StatusUpdatedAtUnixMs).HasColumnName("status_updated_at_unix_ms").IsRequired();
        workload.HasOne<Placement>().WithMany()
            .HasForeignKey(row => row.PlacementId).OnDelete(DeleteBehavior.Restrict);
        workload.HasIndex(row => new { row.PlacementId, row.WorkloadId })
            .HasDatabaseName("workloads_placement_page_idx");

        ConfigureWorkloadConfigTarget(modelBuilder);

        var dependency = modelBuilder.Entity<WorkloadDependency>();
        dependency.ToTable("workload_dependencies");
        dependency.HasKey(row => new
        {
            row.WorkloadId,
            row.ComponentId,
            row.DependencyName
        });
        ConfigureDependencyFields(dependency);
        dependency.Property(row => row.ObservedClaimRevision)
            .HasColumnName("observed_claim_revision").IsRequired();
        dependency.Property(row => row.BindingPhase)
            .HasColumnName("binding_phase").IsRequired();
        dependency.HasIndex(row => row.ClaimId).IsUnique();
        dependency.HasOne<Workload>().WithMany()
            .HasForeignKey(row => row.WorkloadId).OnDelete(DeleteBehavior.Cascade);

        ConfigureDependencyParameter(modelBuilder);
        ConfigureDependencyOutput(modelBuilder);
        ConfigureAppStorageBinding(modelBuilder);
        ConfigureWorkloadStorage(modelBuilder);

        var operation = modelBuilder.Entity<WorkloadOperation>();
        operation.ToTable("workload_operations");
        operation.HasKey(row => new { row.WorkloadId, row.Operation });
        operation.Property(row => row.WorkloadId)
            .HasColumnName("workload_id").HasMaxLength(64).IsRequired();
        operation.Property(row => row.Operation)
            .HasColumnName("operation").HasMaxLength(128).IsRequired();
        operation.HasOne<Workload>().WithMany()
            .HasForeignKey(row => row.WorkloadId)
            .OnDelete(DeleteBehavior.Restrict);

        var item = modelBuilder.Entity<WorkloadInterface>();
        item.ToTable("workload_interfaces");
        item.HasKey(row => new { row.WorkloadId, row.InterfaceId });
        item.Property(row => row.WorkloadId).HasColumnName("workload_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.InterfaceId).HasColumnName("interface_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.Protocol).HasColumnName("protocol").IsRequired();
        item.Property(row => row.ContractId).HasColumnName("contract_id").HasMaxLength(128).IsRequired();
        item.Property(row => row.Port).HasColumnName("port").IsRequired();
        item.Property(row => row.ExposureId).HasColumnName("exposure_id").HasMaxLength(64);
        item.Property(row => row.EndpointHost).HasColumnName("endpoint_host").HasMaxLength(253);
        item.Property(row => row.Ready).HasColumnName("ready").IsRequired();
        item.HasOne<Workload>().WithMany()
            .HasForeignKey(row => row.WorkloadId).OnDelete(DeleteBehavior.Cascade);
    }

    private static void ConfigureRuns(ModelBuilder modelBuilder)
    {
        var run = modelBuilder.Entity<Domain.Runs.Run>();
        run.ToTable("runs");
        run.HasKey(row => row.RunId);
        run.Property(row => row.RunId).HasColumnName("run_id").HasMaxLength(128).IsRequired();
        run.Property(row => row.WorkloadId).HasColumnName("workload_id").HasMaxLength(64).IsRequired();
        run.Property(row => row.WorkloadRevision).HasColumnName("workload_revision").IsRequired();
        run.Property(row => row.PlacementId).HasColumnName("placement_id").HasMaxLength(64).IsRequired();
        run.Property(row => row.TargetKind).HasColumnName("target_kind").IsRequired();
        run.Property(row => row.TenantId).HasColumnName("tenant_id").HasMaxLength(64);
        run.Property(row => row.WorkspaceId).HasColumnName("workspace_id").HasMaxLength(64);
        run.Property(row => row.AccountPrincipalId).HasColumnName("account_principal_id").HasMaxLength(256);
        run.Property(row => row.ActorPrincipalId).HasColumnName("actor_principal_id").HasMaxLength(256);
        run.Property(row => row.AppId).HasColumnName("app_id").HasMaxLength(64).IsRequired();
        run.Property(row => row.AppRevision).HasColumnName("app_revision").IsRequired();
        run.Property(row => row.PackageId).HasColumnName("package_id").HasMaxLength(128).IsRequired();
        run.Property(row => row.PackageGeneration).HasColumnName("package_generation").IsRequired();
        run.Property(row => row.ComponentId).HasColumnName("component_id").HasMaxLength(64).IsRequired();
        run.Property(row => row.ArtifactRepository).HasColumnName("artifact_repository").HasMaxLength(255).IsRequired();
        run.Property(row => row.ArtifactManifestDigest).HasColumnName("artifact_manifest_digest").HasMaxLength(71).IsRequired();
        run.Property(row => row.CpuMillis).HasColumnName("cpu_millis").IsRequired();
        run.Property(row => row.MemoryBytes).HasColumnName("memory_bytes").IsRequired();
        run.Property(row => row.RunDurationSeconds).HasColumnName("run_duration_seconds").IsRequired();
        run.Property(row => row.MaxAttempts).HasColumnName("max_attempts").IsRequired();
        run.Property(row => row.Phase).HasColumnName("phase").IsRequired();
        run.Property(row => row.Reason).HasColumnName("reason").IsRequired();
        run.Property(row => row.AttemptCount).HasColumnName("attempt_count").IsRequired();
        run.Property(row => row.Revision).HasColumnName("revision").IsConcurrencyToken().IsRequired();
        run.Property(row => row.CreatedAtUnixMs).HasColumnName("created_at_unix_ms").IsRequired();
        run.Property(row => row.StartedAtUnixMs).HasColumnName("started_at_unix_ms");
        run.Property(row => row.UpdatedAtUnixMs).HasColumnName("updated_at_unix_ms").IsRequired();
        run.Property(row => row.CompletedAtUnixMs).HasColumnName("completed_at_unix_ms");
        run.HasOne<Workload>().WithMany()
            .HasForeignKey(row => row.WorkloadId).OnDelete(DeleteBehavior.Restrict);
        run.HasOne<Placement>().WithMany()
            .HasForeignKey(row => row.PlacementId).OnDelete(DeleteBehavior.Restrict);
        run.HasIndex(row => new { row.WorkloadId, row.RunId })
            .HasDatabaseName("runs_workload_page_idx");
        run.HasIndex(row => row.PlacementId)
            .HasDatabaseName("runs_placement_idx");
        run.HasIndex(row => new { row.Phase, row.RunId })
            .HasDatabaseName("runs_reconcile_idx");

        ConfigureRunConfigTarget(modelBuilder);

        var dependency = modelBuilder.Entity<RunDependency>();
        dependency.ToTable("run_dependencies");
        dependency.HasKey(row => new
        {
            row.RunId,
            row.ComponentId,
            row.DependencyName
        });
        dependency.Property(row => row.RunId).HasColumnName("run_id").HasMaxLength(128).IsRequired();
        ConfigureRunDependencyFields(dependency);
        dependency.HasOne<Run>().WithMany()
            .HasForeignKey(row => row.RunId).OnDelete(DeleteBehavior.Cascade);

        ConfigureRunDependencyParameter(modelBuilder);
        ConfigureRunDependencyOutput(modelBuilder);
        ConfigureRunStorage(modelBuilder);
    }

    private static void ConfigureDependencyFields(
        Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<WorkloadDependency> item)
    {
        item.Property(row => row.WorkloadId).HasColumnName("workload_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.ComponentId).HasColumnName("component_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.DependencyName).HasColumnName("dependency_name").HasMaxLength(200).IsRequired();
        item.Property(row => row.DependencyId).HasColumnName("dependency_id").HasMaxLength(64);
        item.Property(row => row.DependencyType).HasColumnName("dependency_type").HasMaxLength(128).IsRequired();
        item.Property(row => row.OptionsJson).HasColumnName("options_json").IsRequired();
        item.Property(row => row.OptionsLength).HasColumnName("options_length").IsRequired();
        item.Property(row => row.OptionsSha256).HasColumnName("options_sha256").HasMaxLength(64).IsRequired();
        item.Property(row => row.ProvisionerId).HasColumnName("provisioner_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.ProvisionerSubject).HasColumnName("provisioner_subject").HasMaxLength(256).IsRequired();
        item.Property(row => row.ClaimId).HasColumnName("claim_id").HasMaxLength(36).IsRequired();
        item.Property(row => row.ClaimRevision).HasColumnName("claim_revision").IsRequired();
        item.Property(row => row.BindingId).HasColumnName("binding_id").HasMaxLength(128);
        item.Property(row => row.BindingRevision).HasColumnName("binding_revision");
        item.Property(row => row.ObservedClaimRevision).HasColumnName("observed_claim_revision").IsRequired();
        item.Property(row => row.BindingPhase).HasColumnName("binding_phase").IsRequired();
    }

    private static void ConfigureRunDependencyFields(
        Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<RunDependency> item)
    {
        item.Property(row => row.ComponentId).HasColumnName("component_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.DependencyName).HasColumnName("dependency_name").HasMaxLength(200).IsRequired();
        item.Property(row => row.DependencyId).HasColumnName("dependency_id").HasMaxLength(64);
        item.Property(row => row.DependencyType).HasColumnName("dependency_type").HasMaxLength(128).IsRequired();
        item.Property(row => row.OptionsJson).HasColumnName("options_json").IsRequired();
        item.Property(row => row.OptionsLength).HasColumnName("options_length").IsRequired();
        item.Property(row => row.OptionsSha256).HasColumnName("options_sha256").HasMaxLength(64).IsRequired();
        item.Property(row => row.ProvisionerId).HasColumnName("provisioner_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.ProvisionerSubject).HasColumnName("provisioner_subject").HasMaxLength(256).IsRequired();
        item.Property(row => row.ClaimId).HasColumnName("claim_id").HasMaxLength(36).IsRequired();
        item.Property(row => row.ClaimRevision).HasColumnName("claim_revision").IsRequired();
        item.Property(row => row.BindingId).HasColumnName("binding_id").HasMaxLength(128);
        item.Property(row => row.BindingRevision).HasColumnName("binding_revision");
        item.Property(row => row.ObservedClaimRevision)
            .HasColumnName("observed_claim_revision").IsRequired();
        item.Property(row => row.BindingPhase)
            .HasColumnName("binding_phase").IsRequired();
    }

    private static void ConfigureDependencyParameter(ModelBuilder modelBuilder)
    {
        var item = modelBuilder.Entity<WorkloadDependencyParameter>();
        item.ToTable("workload_dependency_parameters");
        item.HasKey(row => new
        {
            row.WorkloadId,
            row.ComponentId,
            row.DependencyName,
            row.ParameterName
        });
        item.Property(row => row.WorkloadId).HasColumnName("workload_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.ComponentId).HasColumnName("component_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.DependencyName).HasColumnName("dependency_name").HasMaxLength(200).IsRequired();
        item.Property(row => row.ParameterName).HasColumnName("parameter_name").HasMaxLength(64).IsRequired();
        item.Property(row => row.DataKind).HasColumnName("data_kind").IsRequired();
        item.Property(row => row.Purpose).HasColumnName("purpose").HasMaxLength(64).IsRequired();
        item.Property(row => row.TargetId).HasColumnName("target_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.TargetVersionId).HasColumnName("target_version_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.ProjectionId).HasColumnName("projection_id").HasMaxLength(56);
        item.Property(row => row.ProjectionRevision).HasColumnName("projection_revision");
        item.HasOne<WorkloadDependency>().WithMany()
            .HasForeignKey(row => new
            {
                row.WorkloadId,
                row.ComponentId,
                row.DependencyName
            }).OnDelete(DeleteBehavior.Cascade);
    }

    private static void ConfigureDependencyOutput(ModelBuilder modelBuilder)
    {
        var item = modelBuilder.Entity<WorkloadDependencyOutput>();
        item.ToTable("workload_dependency_outputs");
        item.HasKey(row => new
        {
            row.WorkloadId,
            row.ComponentId,
            row.DependencyName,
            row.DataKind,
            row.Purpose
        });
        item.Property(row => row.WorkloadId).HasColumnName("workload_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.ComponentId).HasColumnName("component_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.DependencyName).HasColumnName("dependency_name").HasMaxLength(200).IsRequired();
        item.Property(row => row.DataKind).HasColumnName("data_kind").IsRequired();
        item.Property(row => row.Purpose).HasColumnName("purpose").HasMaxLength(64).IsRequired();
        item.Property(row => row.TargetId).HasColumnName("target_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.TargetVersionId).HasColumnName("target_version_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.ProjectionId).HasColumnName("projection_id").HasMaxLength(56);
        item.Property(row => row.ProjectionRevision).HasColumnName("projection_revision");
        item.HasOne<WorkloadDependency>().WithMany()
            .HasForeignKey(row => new
            {
                row.WorkloadId,
                row.ComponentId,
                row.DependencyName
            }).OnDelete(DeleteBehavior.Cascade);
    }

    private static void ConfigureRunDependencyParameter(ModelBuilder modelBuilder)
    {
        var item = modelBuilder.Entity<RunDependencyParameter>();
        item.ToTable("run_dependency_parameters");
        item.HasKey(row => new
        {
            row.RunId,
            row.ComponentId,
            row.DependencyName,
            row.ParameterName
        });
        item.Property(row => row.RunId).HasColumnName("run_id").HasMaxLength(128).IsRequired();
        item.Property(row => row.ComponentId).HasColumnName("component_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.DependencyName).HasColumnName("dependency_name").HasMaxLength(200).IsRequired();
        item.Property(row => row.ParameterName).HasColumnName("parameter_name").HasMaxLength(64).IsRequired();
        item.Property(row => row.DataKind).HasColumnName("data_kind").IsRequired();
        item.Property(row => row.Purpose).HasColumnName("purpose").HasMaxLength(64).IsRequired();
        item.Property(row => row.TargetId).HasColumnName("target_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.TargetVersionId).HasColumnName("target_version_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.ProjectionId).HasColumnName("projection_id").HasMaxLength(56).IsRequired();
        item.Property(row => row.ProjectionRevision).HasColumnName("projection_revision").IsRequired();
        item.HasOne<RunDependency>().WithMany()
            .HasForeignKey(row => new
            {
                row.RunId,
                row.ComponentId,
                row.DependencyName
            }).OnDelete(DeleteBehavior.Cascade);
    }

    private static void ConfigureRunDependencyOutput(ModelBuilder modelBuilder)
    {
        var item = modelBuilder.Entity<RunDependencyOutput>();
        item.ToTable("run_dependency_outputs");
        item.HasKey(row => new
        {
            row.RunId,
            row.ComponentId,
            row.DependencyName,
            row.DataKind,
            row.Purpose
        });
        item.Property(row => row.RunId).HasColumnName("run_id").HasMaxLength(128).IsRequired();
        item.Property(row => row.ComponentId).HasColumnName("component_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.DependencyName).HasColumnName("dependency_name").HasMaxLength(200).IsRequired();
        item.Property(row => row.DataKind).HasColumnName("data_kind").IsRequired();
        item.Property(row => row.Purpose).HasColumnName("purpose").HasMaxLength(64).IsRequired();
        item.Property(row => row.TargetId).HasColumnName("target_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.TargetVersionId).HasColumnName("target_version_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.ProjectionId).HasColumnName("projection_id").HasMaxLength(56).IsRequired();
        item.Property(row => row.ProjectionRevision).HasColumnName("projection_revision").IsRequired();
        item.HasOne<RunDependency>().WithMany()
            .HasForeignKey(row => new
            {
                row.RunId,
                row.ComponentId,
                row.DependencyName
            }).OnDelete(DeleteBehavior.Cascade);
    }

    private static void ConfigureWorkloadConfigTarget(ModelBuilder modelBuilder)
    {
        var item = modelBuilder.Entity<WorkloadConfigTarget>();
        item.ToTable("workload_config_targets");
        item.HasKey(row => new { row.WorkloadId, row.DataKind, row.Purpose });
        item.Property(row => row.WorkloadId).HasColumnName("workload_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.DataKind).HasColumnName("data_kind").IsRequired();
        item.Property(row => row.Purpose).HasColumnName("purpose").HasMaxLength(64).IsRequired();
        item.Property(row => row.TargetId).HasColumnName("target_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.TargetVersionId).HasColumnName("target_version_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.ProjectionId).HasColumnName("projection_id").HasMaxLength(56);
        item.Property(row => row.ProjectionRevision).HasColumnName("projection_revision");
        item.HasOne<Workload>().WithMany()
            .HasForeignKey(row => row.WorkloadId).OnDelete(DeleteBehavior.Cascade);
    }

    private static void ConfigureRunConfigTarget(ModelBuilder modelBuilder)
    {
        var item = modelBuilder.Entity<RunConfigTarget>();
        item.ToTable("run_config_targets");
        item.HasKey(row => new { row.RunId, row.DataKind, row.Purpose });
        item.Property(row => row.RunId).HasColumnName("run_id").HasMaxLength(128).IsRequired();
        item.Property(row => row.DataKind).HasColumnName("data_kind").IsRequired();
        item.Property(row => row.Purpose).HasColumnName("purpose").HasMaxLength(64).IsRequired();
        item.Property(row => row.TargetId).HasColumnName("target_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.TargetVersionId).HasColumnName("target_version_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.ProjectionId).HasColumnName("projection_id").HasMaxLength(56);
        item.Property(row => row.ProjectionRevision).HasColumnName("projection_revision");
        item.HasOne<Run>().WithMany()
            .HasForeignKey(row => row.RunId).OnDelete(DeleteBehavior.Cascade);
    }

    private static void ConfigureWorkloadStorage(ModelBuilder modelBuilder)
    {
        var item = modelBuilder.Entity<WorkloadStorage>();
        item.ToTable("workload_storage");
        item.HasKey(row => new { row.WorkloadId, row.StorageId });
        item.Property(row => row.WorkloadId).HasColumnName("workload_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.PlacementId).HasColumnName("placement_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.AppId).HasColumnName("app_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.StorageId).HasColumnName("storage_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.MountPath).HasColumnName("mount_path").HasMaxLength(256).IsRequired();
        item.HasIndex(row => new
        {
            row.PlacementId,
            row.AppId,
            row.StorageId
        });
        item.HasIndex(row => new { row.WorkloadId, row.MountPath }).IsUnique();
        item.HasOne<Workload>().WithMany()
            .HasForeignKey(row => row.WorkloadId)
            .OnDelete(DeleteBehavior.Cascade);
        item.HasOne<AppStorageBinding>().WithMany()
            .HasForeignKey(row => new
            {
                row.PlacementId,
                row.AppId,
                row.StorageId
            })
            .HasPrincipalKey(row => new
            {
                row.PlacementId,
                row.AppId,
                row.StorageId
            })
            .OnDelete(DeleteBehavior.Restrict);
    }

    private static void ConfigureAppStorageBinding(ModelBuilder modelBuilder)
    {
        var item = modelBuilder.Entity<AppStorageBinding>();
        item.ToTable("app_storage_bindings");
        item.HasKey(row => new
        {
            row.PlacementId,
            row.AppId,
            row.StorageId
        });
        item.Property(row => row.PlacementId).HasColumnName("placement_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.AppId).HasColumnName("app_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.StorageId).HasColumnName("storage_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.CapacityBytes).HasColumnName("capacity_bytes").IsRequired();
        item.HasOne<Placement>().WithMany()
            .HasForeignKey(row => row.PlacementId)
            .OnDelete(DeleteBehavior.Restrict);
    }

    private static void ConfigureRunStorage(ModelBuilder modelBuilder)
    {
        var item = modelBuilder.Entity<RunStorage>();
        item.ToTable("run_storage");
        item.HasKey(row => new { row.RunId, row.StorageId });
        item.Property(row => row.RunId).HasColumnName("run_id").HasMaxLength(128).IsRequired();
        item.Property(row => row.PlacementId).HasColumnName("placement_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.AppId).HasColumnName("app_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.StorageId).HasColumnName("storage_id").HasMaxLength(64).IsRequired();
        item.Property(row => row.MountPath).HasColumnName("mount_path").HasMaxLength(256).IsRequired();
        item.HasIndex(row => new
        {
            row.PlacementId,
            row.AppId,
            row.StorageId
        });
        item.HasIndex(row => new { row.RunId, row.MountPath }).IsUnique();
        item.HasOne<Run>().WithMany()
            .HasForeignKey(row => row.RunId)
            .OnDelete(DeleteBehavior.Cascade);
        item.HasOne<AppStorageBinding>().WithMany()
            .HasForeignKey(row => new
            {
                row.PlacementId,
                row.AppId,
                row.StorageId
            })
            .HasPrincipalKey(row => new
            {
                row.PlacementId,
                row.AppId,
                row.StorageId
            })
            .OnDelete(DeleteBehavior.Restrict);
    }
}
