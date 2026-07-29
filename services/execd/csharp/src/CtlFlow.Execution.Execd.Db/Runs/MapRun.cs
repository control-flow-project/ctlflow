using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Domain.Time;
using CtlFlow.Execution.Execd.Domain.Workloads;
using static CtlFlow.Execution.Execd.Db.Workloads.WorkloadRows;

namespace CtlFlow.Execution.Execd.Db.Runs;

internal static partial class RunRows
{
    internal static RunRecord MapRun(
        Run row,
        IReadOnlyList<RunConfigTarget> configTargets,
        IReadOnlyList<RunDependency> dependencies,
        IReadOnlyList<RunDependencyParameter> parameters,
        IReadOnlyList<RunDependencyOutput> outputs,
        IReadOnlyList<RunStorage> storage)
    {
        try
        {
            return new RunRecord(
                RunId.Parse(row.RunId),
                WorkloadId.Parse(row.WorkloadId),
                Revision.FromStorage(row.WorkloadRevision),
                PlacementId.Parse(row.PlacementId),
                Placements.PlacementRows.MapTarget(
                    row.TargetKind,
                    row.TenantId,
                    row.WorkspaceId,
                    row.AccountPrincipalId),
                row.ActorPrincipalId is null
                    ? null
                    : PrincipalId.Parse(row.ActorPrincipalId),
                new RunExecutionSnapshot(
                    new AdmittedPackageComponent(
                        AppId.Parse(row.AppId),
                        Revision.FromStorage(row.AppRevision),
                        PackageId.Parse(row.PackageId),
                        Revision.FromStorage(
                            row.PackageGeneration),
                        ComponentId.Parse(row.ComponentId),
                        ArtifactRepository.Parse(
                            row.ArtifactRepository),
                        ManifestDigest.Parse(
                            row.ArtifactManifestDigest)),
                    ExecutionResources.Create(
                        (uint)row.CpuMillis,
                        (ulong)row.MemoryBytes),
                    configTargets
                        .OrderBy(item => item.DataKind)
                        .ThenBy(item => item.Purpose)
                        .Select(MapConfigTarget)
                        .ToArray(),
                    dependencies
                        .OrderBy(item => item.ComponentId)
                        .ThenBy(item => item.DependencyName)
                        .Select(item => MapDependency(
                            item,
                            parameters,
                            outputs))
                        .ToArray(),
                    storage
                        .OrderBy(item => item.StorageId)
                        .Select(item => new PersistentStorage(
                            StorageId.Parse(item.StorageId),
                            MountPath.Parse(item.MountPath),
                            item.CapacityBytes))
                        .ToArray(),
                    row.RunDurationSeconds,
                    row.MaxAttempts),
                ParsePhase(row.Phase),
                ParseReason(row.Reason),
                row.AttemptCount,
                Revision.FromStorage(row.Revision),
                UtcInstant.FromStorage(row.CreatedAtUnixMs),
                row.StartedAtUnixMs is null
                    ? null
                    : UtcInstant.FromStorage(
                        row.StartedAtUnixMs.Value),
                UtcInstant.FromStorage(row.UpdatedAtUnixMs),
                row.CompletedAtUnixMs is null
                    ? null
                    : UtcInstant.FromStorage(
                        row.CompletedAtUnixMs.Value));
        }
        catch (Exception exception) when (
            exception is ArgumentException or InvalidOperationException
                or OverflowException)
        {
            throw new ExecutionException(
                ExecutionError.Unavailable,
                "Stored Run state is invalid");
        }
    }

    private static AdmittedDependency MapDependency(
        RunDependency row,
        IReadOnlyList<RunDependencyParameter> parameters,
        IReadOnlyList<RunDependencyOutput> outputs)
    {
        var component = ComponentId.Parse(row.ComponentId);
        var name = DependencyName.Parse(row.DependencyName);
        return new AdmittedDependency(
            new DependencySelection(
                component,
                name,
                row.DependencyId is null
                    ? null
                    : DependencyId.Parse(row.DependencyId),
                parameters.Where(item =>
                        item.ComponentId == row.ComponentId
                        && item.DependencyName
                            == row.DependencyName)
                    .OrderBy(item => item.ParameterName)
                    .Select(item => new ProvisioningParameter(
                        ParameterName.Parse(item.ParameterName),
                        MapConfigTarget(item)))
                    .ToArray()),
            DependencyType.Parse(row.DependencyType),
            row.OptionsLength,
            row.OptionsSha256,
            ProvisionerId.Parse(row.ProvisionerId),
            ProvisionerSubject.Parse(row.ProvisionerSubject),
            row.ClaimId,
            Revision.FromStorage(row.ClaimRevision),
            row.ObservedClaimRevision,
            ParseBindingPhase(row.BindingPhase),
            row.BindingId is null
                ? null
                : BindingId.Parse(row.BindingId),
            row.BindingRevision is null
                ? null
                : Revision.FromStorage(row.BindingRevision.Value),
            outputs.Where(item =>
                    item.ComponentId == row.ComponentId
                    && item.DependencyName
                        == row.DependencyName)
                .OrderBy(item => item.DataKind)
                .ThenBy(item => item.Purpose)
                .Select(MapConfigTarget)
                .ToArray());
    }

    internal static RunPhase ParsePhase(int value) =>
        value switch
        {
            1 => RunPhase.Pending,
            2 => RunPhase.Starting,
            3 => RunPhase.Running,
            4 => RunPhase.Cancelling,
            5 => RunPhase.Succeeded,
            6 => RunPhase.Failed,
            7 => RunPhase.Cancelled,
            _ => throw new InvalidOperationException(
                "Stored Run phase is invalid")
        };

    internal static RunReason ParseReason(int value) =>
        value switch
        {
            1 => RunReason.None,
            2 => RunReason.CancelRequested,
            3 => RunReason.PlacementInactive,
            4 => RunReason.WorkloadInactive,
            5 => RunReason.BindingUnavailable,
            6 => RunReason.InvocationNotAdmitted,
            7 => RunReason.InvocationUnavailable,
            8 => RunReason.KubernetesUnavailable,
            9 => RunReason.RealizationRejected,
            10 => RunReason.OwnershipConflict,
            11 => RunReason.ExecutionFailed,
            12 => RunReason.DurationExceeded,
            _ => throw new InvalidOperationException(
                "Stored Run reason is invalid")
        };

    private static DependencyBindingPhase ParseBindingPhase(
        int value) =>
        value switch
        {
            1 => DependencyBindingPhase.Pending,
            2 => DependencyBindingPhase.Ready,
            3 => DependencyBindingPhase.Rejected,
            _ => throw new InvalidOperationException(
                "Stored dependency phase is invalid")
        };
}
