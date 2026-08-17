using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Storage;
using CtlFlow.Execution.Execd.Domain.Workloads;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Execution.Execd.Db.Storage.StorageBindings;

namespace CtlFlow.Execution.Execd.Db.Workloads;

public static partial class Workloads
{
    public static async Task<WorkloadRecord> GetWorkload(
        ExecutionDatabase database,
        WorkloadId workloadId,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "get_workload");
        return await LoadWorkload(database, workloadId, cancellation)
            ?? throw new ExecutionException(
                ExecutionError.NotFound,
                "Workload was not found");
    }

    internal static async Task<WorkloadRecord?> LoadWorkload(
        ExecutionDatabase database,
        WorkloadId workloadId,
        CancellationToken cancellation)
    {
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var id = workloadId.Value;
        var queryCancellation = cancellation;
        var row = await context.Workloads
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "WorkloadId") == id)
            .Select(item => new
            {
                WorkloadId =
                    EF.Property<string>(item, "WorkloadId"),
                PlacementId =
                    EF.Property<string>(item, "PlacementId"),
                DesiredState =
                    EF.Property<int>(item, "DesiredState"),
                Mode = EF.Property<int>(item, "Mode"),
                AppId = EF.Property<string>(item, "AppId"),
                AppRevision =
                    EF.Property<long>(item, "AppRevision"),
                PackageId =
                    EF.Property<string>(item, "PackageId"),
                PackageGeneration =
                    EF.Property<long>(item, "PackageGeneration"),
                ComponentId =
                    EF.Property<string>(item, "ComponentId"),
                ServiceAccountSubject = EF.Property<string>(
                    item,
                    "ServiceAccountSubject"),
                ArtifactRepository = EF.Property<string>(
                    item,
                    "ArtifactRepository"),
                ArtifactManifestDigest = EF.Property<string>(
                    item,
                    "ArtifactManifestDigest"),
                CpuMillis = EF.Property<int>(item, "CpuMillis"),
                MemoryBytes =
                    EF.Property<long>(item, "MemoryBytes"),
                Replicas = EF.Property<int?>(item, "Replicas"),
                ActorPrincipalId = EF.Property<string?>(
                    item,
                    "ActorPrincipalId"),
                RunDurationSeconds = EF.Property<long?>(
                    item,
                    "RunDurationSeconds"),
                MaxAttempts =
                    EF.Property<int?>(item, "MaxAttempts"),
                Revision = EF.Property<long>(item, "Revision"),
                StatusRevision =
                    EF.Property<long>(item, "StatusRevision"),
                ObservedRevision =
                    EF.Property<long>(item, "ObservedRevision"),
                RealizationPhase =
                    EF.Property<int>(item, "RealizationPhase"),
                RealizationReason =
                    EF.Property<int>(item, "RealizationReason"),
                CreatedAtUnixMs =
                    EF.Property<long>(item, "CreatedAtUnixMs"),
                UpdatedAtUnixMs =
                    EF.Property<long>(item, "UpdatedAtUnixMs"),
                StatusUpdatedAtUnixMs = EF.Property<long>(
                    item,
                    "StatusUpdatedAtUnixMs")
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (row is null)
        {
            return null;
        }

        var targets = await context.WorkloadConfigTargets
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "WorkloadId") == id)
            .Select(item => new
            {
                WorkloadId =
                    EF.Property<string>(item, "WorkloadId"),
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
        var dependencies = await context.WorkloadDependencies
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "WorkloadId") == id)
            .Select(item => new
            {
                WorkloadId =
                    EF.Property<string>(item, "WorkloadId"),
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
        var parameters = await context.WorkloadDependencyParameters
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "WorkloadId") == id)
            .Select(item => new
            {
                WorkloadId =
                    EF.Property<string>(item, "WorkloadId"),
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
                    EF.Property<string?>(item, "ProjectionId"),
                ProjectionRevision =
                    EF.Property<long?>(item, "ProjectionRevision")
            })
            .ToListAsync(queryCancellation);
        var outputs = await context.WorkloadDependencyOutputs
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "WorkloadId") == id)
            .Select(item => new
            {
                WorkloadId =
                    EF.Property<string>(item, "WorkloadId"),
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
                    EF.Property<string?>(item, "ProjectionId"),
                ProjectionRevision =
                    EF.Property<long?>(item, "ProjectionRevision")
            })
            .ToListAsync(queryCancellation);
        var storage = await context.WorkloadStorage
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "WorkloadId") == id)
            .Select(item => new
            {
                WorkloadId =
                    EF.Property<string>(item, "WorkloadId"),
                PlacementId =
                    EF.Property<string>(item, "PlacementId"),
                AppId = EF.Property<string>(item, "AppId"),
                StorageId =
                    EF.Property<string>(item, "StorageId"),
                MountPath =
                    EF.Property<string>(item, "MountPath")
            })
            .ToListAsync(queryCancellation);
        IReadOnlyList<PersistentStorage> restoredStorage;
        try
        {
            var placementId = PlacementId.Parse(row.PlacementId);
            var appId = AppId.Parse(row.AppId);
            var facts = storage.Select(item => new AppStorageConsumerFact(
                PlacementId.Parse(item.PlacementId),
                AppId.Parse(item.AppId),
                StorageId.Parse(item.StorageId),
                MountPath.Parse(item.MountPath))).ToArray();
            var bindings = await LoadAppStorageBindings(
                database,
                placementId,
                appId,
                facts.Select(item => item.StorageId).ToArray(),
                cancellation);
            restoredStorage = await Domain.Storage.StorageBindings
                .RestorePersistentStorage(
                    placementId,
                    appId,
                    facts,
                    bindings,
                    cancellation);
        }
        catch (ExecutionException)
        {
            throw;
        }
        catch (Exception exception) when (
            exception is ArgumentException or InvalidOperationException
                or OverflowException)
        {
            throw new ExecutionException(
                ExecutionError.Unavailable,
                "Stored Workload storage is invalid");
        }
        var interfaces = await context.WorkloadInterfaces
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "WorkloadId") == id)
            .Select(item => new
            {
                WorkloadId =
                    EF.Property<string>(item, "WorkloadId"),
                InterfaceId =
                    EF.Property<string>(item, "InterfaceId"),
                Protocol = EF.Property<int>(item, "Protocol"),
                ContractId =
                    EF.Property<string>(item, "ContractId"),
                Port = EF.Property<int>(item, "Port"),
                ExposureId =
                    EF.Property<string?>(item, "ExposureId"),
                EndpointHost =
                    EF.Property<string?>(item, "EndpointHost"),
                Ready = EF.Property<bool>(item, "Ready")
            })
            .ToListAsync(queryCancellation);
        var operations = await context.WorkloadOperations
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "WorkloadId") == id)
            .Select(item => new
            {
                WorkloadId = EF.Property<string>(item, "WorkloadId"),
                Operation = EF.Property<string>(item, "Operation")
            })
            .ToListAsync(queryCancellation);
        return WorkloadRows.MapWorkload(
            Workload.RestoreStorage(
                row.WorkloadId,
                row.PlacementId,
                row.DesiredState,
                row.Mode,
                row.AppId,
                row.AppRevision,
                row.PackageId,
                row.PackageGeneration,
                row.ComponentId,
                row.ServiceAccountSubject,
                row.ArtifactRepository,
                row.ArtifactManifestDigest,
                row.CpuMillis,
                row.MemoryBytes,
                row.Replicas,
                row.ActorPrincipalId,
                row.RunDurationSeconds,
                row.MaxAttempts,
                row.Revision,
                row.StatusRevision,
                row.ObservedRevision,
                row.RealizationPhase,
                row.RealizationReason,
                row.CreatedAtUnixMs,
                row.UpdatedAtUnixMs,
                row.StatusUpdatedAtUnixMs),
            targets.Select(item => new WorkloadConfigTarget
            {
                WorkloadId = item.WorkloadId,
                DataKind = item.DataKind,
                Purpose = item.Purpose,
                TargetId = item.TargetId,
                TargetVersionId = item.TargetVersionId,
                ProjectionId = item.ProjectionId,
                ProjectionRevision = item.ProjectionRevision
            }).ToArray(),
            dependencies.Select(item => new WorkloadDependency
            {
                WorkloadId = item.WorkloadId,
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
            parameters.Select(item => new WorkloadDependencyParameter
            {
                WorkloadId = item.WorkloadId,
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
            outputs.Select(item => new WorkloadDependencyOutput
            {
                WorkloadId = item.WorkloadId,
                ComponentId = item.ComponentId,
                DependencyName = item.DependencyName,
                DataKind = item.DataKind,
                Purpose = item.Purpose,
                TargetId = item.TargetId,
                TargetVersionId = item.TargetVersionId,
                ProjectionId = item.ProjectionId,
                ProjectionRevision = item.ProjectionRevision
            }).ToArray(),
            restoredStorage,
            interfaces.Select(item => new WorkloadInterface
            {
                WorkloadId = item.WorkloadId,
                InterfaceId = item.InterfaceId,
                Protocol = item.Protocol,
                ContractId = item.ContractId,
                Port = item.Port,
                ExposureId = item.ExposureId,
                EndpointHost = item.EndpointHost,
                Ready = item.Ready
            }).ToArray(),
            operations.Select(item => new WorkloadOperation
            {
                WorkloadId = item.WorkloadId,
                Operation = item.Operation
            }).ToArray());
    }
}
