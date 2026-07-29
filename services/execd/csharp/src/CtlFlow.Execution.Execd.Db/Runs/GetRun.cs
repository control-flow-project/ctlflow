using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Runs;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Runs;

public static partial class Runs
{
    public static async Task<RunRecord> GetRun(
        ExecutionDatabase database,
        RunId runId,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation("get_run");
        return await LoadRun(database, runId, cancellation)
            ?? throw new ExecutionException(
                ExecutionError.NotFound,
                "Run was not found");
    }

    internal static async Task<RunRecord?> LoadRun(
        ExecutionDatabase database,
        RunId runId,
        CancellationToken cancellation)
    {
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var id = runId.Value;
        var queryCancellation = cancellation;
        var row = await context.Runs.AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "RunId") == id)
            .Select(item => new
            {
                RunId = EF.Property<string>(item, "RunId"),
                WorkloadId =
                    EF.Property<string>(item, "WorkloadId"),
                WorkloadRevision =
                    EF.Property<long>(item, "WorkloadRevision"),
                PlacementId =
                    EF.Property<string>(item, "PlacementId"),
                TargetKind = EF.Property<int>(item, "TargetKind"),
                TenantId = EF.Property<string?>(item, "TenantId"),
                WorkspaceId =
                    EF.Property<string?>(item, "WorkspaceId"),
                AccountPrincipalId = EF.Property<string?>(
                    item,
                    "AccountPrincipalId"),
                ActorPrincipalId = EF.Property<string?>(
                    item,
                    "ActorPrincipalId"),
                AppId = EF.Property<string>(item, "AppId"),
                AppRevision =
                    EF.Property<long>(item, "AppRevision"),
                PackageId =
                    EF.Property<string>(item, "PackageId"),
                PackageGeneration =
                    EF.Property<long>(item, "PackageGeneration"),
                ComponentId =
                    EF.Property<string>(item, "ComponentId"),
                ArtifactRepository = EF.Property<string>(
                    item,
                    "ArtifactRepository"),
                ArtifactManifestDigest = EF.Property<string>(
                    item,
                    "ArtifactManifestDigest"),
                CpuMillis = EF.Property<int>(item, "CpuMillis"),
                MemoryBytes =
                    EF.Property<long>(item, "MemoryBytes"),
                RunDurationSeconds = EF.Property<long>(
                    item,
                    "RunDurationSeconds"),
                MaxAttempts =
                    EF.Property<int>(item, "MaxAttempts"),
                Phase = EF.Property<int>(item, "Phase"),
                Reason = EF.Property<int>(item, "Reason"),
                AttemptCount =
                    EF.Property<int>(item, "AttemptCount"),
                Revision = EF.Property<long>(item, "Revision"),
                CreatedAtUnixMs =
                    EF.Property<long>(item, "CreatedAtUnixMs"),
                StartedAtUnixMs =
                    EF.Property<long?>(item, "StartedAtUnixMs"),
                UpdatedAtUnixMs =
                    EF.Property<long>(item, "UpdatedAtUnixMs"),
                CompletedAtUnixMs =
                    EF.Property<long?>(item, "CompletedAtUnixMs")
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (row is null)
        {
            return null;
        }

        var targets = await context.RunConfigTargets
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "RunId") == id)
            .Select(item => new
            {
                RunId = EF.Property<string>(item, "RunId"),
                DataKind = EF.Property<int>(item, "DataKind"),
                Purpose = EF.Property<string>(item, "Purpose"),
                TargetId = EF.Property<string>(item, "TargetId"),
                TargetVersionId =
                    EF.Property<string>(item, "TargetVersionId"),
                ProjectionId =
                    EF.Property<string?>(item, "ProjectionId"),
                ProjectionRevision =
                    EF.Property<long?>(item, "ProjectionRevision")
            })
            .ToListAsync(queryCancellation);
        var dependencies = await context.RunDependencies
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "RunId") == id)
            .Select(item => new
            {
                RunId = EF.Property<string>(item, "RunId"),
                ComponentId =
                    EF.Property<string>(item, "ComponentId"),
                DependencyName =
                    EF.Property<string>(item, "DependencyName"),
                DependencyId =
                    EF.Property<string?>(item, "DependencyId"),
                DependencyType =
                    EF.Property<string>(item, "DependencyType"),
                OptionsJson =
                    EF.Property<byte[]>(item, "OptionsJson"),
                OptionsLength =
                    EF.Property<int>(item, "OptionsLength"),
                OptionsSha256 =
                    EF.Property<string>(item, "OptionsSha256"),
                ProvisionerId =
                    EF.Property<string>(item, "ProvisionerId"),
                ProvisionerSubject =
                    EF.Property<string>(item, "ProvisionerSubject"),
                ClaimId = EF.Property<string>(item, "ClaimId"),
                ClaimRevision =
                    EF.Property<long>(item, "ClaimRevision"),
                BindingId =
                    EF.Property<string?>(item, "BindingId"),
                BindingRevision =
                    EF.Property<long?>(item, "BindingRevision"),
                ObservedClaimRevision = EF.Property<long>(
                    item,
                    "ObservedClaimRevision"),
                BindingPhase =
                    EF.Property<int>(item, "BindingPhase")
            })
            .ToListAsync(queryCancellation);
        var parameters = await context.RunDependencyParameters
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "RunId") == id)
            .Select(item => new
            {
                RunId = EF.Property<string>(item, "RunId"),
                ComponentId =
                    EF.Property<string>(item, "ComponentId"),
                DependencyName =
                    EF.Property<string>(item, "DependencyName"),
                ParameterName =
                    EF.Property<string>(item, "ParameterName"),
                DataKind = EF.Property<int>(item, "DataKind"),
                Purpose = EF.Property<string>(item, "Purpose"),
                TargetId = EF.Property<string>(item, "TargetId"),
                TargetVersionId =
                    EF.Property<string>(item, "TargetVersionId"),
                ProjectionId =
                    EF.Property<string>(item, "ProjectionId"),
                ProjectionRevision =
                    EF.Property<long>(item, "ProjectionRevision")
            })
            .ToListAsync(queryCancellation);
        var outputs = await context.RunDependencyOutputs
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "RunId") == id)
            .Select(item => new
            {
                RunId = EF.Property<string>(item, "RunId"),
                ComponentId =
                    EF.Property<string>(item, "ComponentId"),
                DependencyName =
                    EF.Property<string>(item, "DependencyName"),
                DataKind = EF.Property<int>(item, "DataKind"),
                Purpose = EF.Property<string>(item, "Purpose"),
                TargetId = EF.Property<string>(item, "TargetId"),
                TargetVersionId =
                    EF.Property<string>(item, "TargetVersionId"),
                ProjectionId =
                    EF.Property<string>(item, "ProjectionId"),
                ProjectionRevision =
                    EF.Property<long>(item, "ProjectionRevision")
            })
            .ToListAsync(queryCancellation);
        var storage = await context.RunStorage
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "RunId") == id)
            .Select(item => new
            {
                RunId = EF.Property<string>(item, "RunId"),
                StorageId =
                    EF.Property<string>(item, "StorageId"),
                MountPath =
                    EF.Property<string>(item, "MountPath"),
                CapacityBytes =
                    EF.Property<long>(item, "CapacityBytes")
            })
            .ToListAsync(queryCancellation);
        return RunRows.MapRun(
            Run.RestoreStorage(
                row.RunId,
                row.WorkloadId,
                row.WorkloadRevision,
                row.PlacementId,
                row.TargetKind,
                row.TenantId,
                row.WorkspaceId,
                row.AccountPrincipalId,
                row.ActorPrincipalId,
                row.AppId,
                row.AppRevision,
                row.PackageId,
                row.PackageGeneration,
                row.ComponentId,
                row.ArtifactRepository,
                row.ArtifactManifestDigest,
                row.CpuMillis,
                row.MemoryBytes,
                row.RunDurationSeconds,
                row.MaxAttempts,
                row.Phase,
                row.Reason,
                row.AttemptCount,
                row.Revision,
                row.CreatedAtUnixMs,
                row.StartedAtUnixMs,
                row.UpdatedAtUnixMs,
                row.CompletedAtUnixMs),
            targets.Select(item => new RunConfigTarget
            {
                RunId = item.RunId,
                DataKind = item.DataKind,
                Purpose = item.Purpose,
                TargetId = item.TargetId,
                TargetVersionId = item.TargetVersionId,
                ProjectionId = item.ProjectionId,
                ProjectionRevision = item.ProjectionRevision
            }).ToArray(),
            dependencies.Select(item => new RunDependency
            {
                RunId = item.RunId,
                ComponentId = item.ComponentId,
                DependencyName = item.DependencyName,
                DependencyId = item.DependencyId,
                DependencyType = item.DependencyType,
                OptionsJson = item.OptionsJson,
                OptionsLength = item.OptionsLength,
                OptionsSha256 = item.OptionsSha256,
                ProvisionerId = item.ProvisionerId,
                ProvisionerSubject = item.ProvisionerSubject,
                ClaimId = item.ClaimId,
                ClaimRevision = item.ClaimRevision,
                BindingId = item.BindingId,
                BindingRevision = item.BindingRevision,
                ObservedClaimRevision = item.ObservedClaimRevision,
                BindingPhase = item.BindingPhase
            }).ToArray(),
            parameters.Select(item => new RunDependencyParameter
            {
                RunId = item.RunId,
                ComponentId = item.ComponentId,
                DependencyName = item.DependencyName,
                ParameterName = item.ParameterName,
                DataKind = item.DataKind,
                Purpose = item.Purpose,
                TargetId = item.TargetId,
                TargetVersionId = item.TargetVersionId,
                ProjectionId = item.ProjectionId,
                ProjectionRevision = item.ProjectionRevision
            }).ToArray(),
            outputs.Select(item => new RunDependencyOutput
            {
                RunId = item.RunId,
                ComponentId = item.ComponentId,
                DependencyName = item.DependencyName,
                DataKind = item.DataKind,
                Purpose = item.Purpose,
                TargetId = item.TargetId,
                TargetVersionId = item.TargetVersionId,
                ProjectionId = item.ProjectionId,
                ProjectionRevision = item.ProjectionRevision
            }).ToArray(),
            storage.Select(item => new RunStorage
            {
                RunId = item.RunId,
                StorageId = item.StorageId,
                MountPath = item.MountPath,
                CapacityBytes = item.CapacityBytes
            }).ToArray());
    }
}
