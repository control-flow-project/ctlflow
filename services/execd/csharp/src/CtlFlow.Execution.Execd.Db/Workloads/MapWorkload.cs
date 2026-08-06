using CtlFlow.Execution.Execd.Db.Persistence;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Naming;
using CtlFlow.Execution.Execd.Domain.Operations;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Time;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Db.Workloads;

internal static partial class WorkloadRows
{
    internal static WorkloadRecord MapWorkload(
        Workload row,
        IReadOnlyList<WorkloadConfigTarget> configTargets,
        IReadOnlyList<WorkloadDependency> dependencies,
        IReadOnlyList<WorkloadDependencyParameter> parameters,
        IReadOnlyList<WorkloadDependencyOutput> outputs,
        IReadOnlyList<WorkloadStorage> storage,
        IReadOnlyList<WorkloadInterface> interfaces,
        IReadOnlyList<WorkloadOperation> operations)
    {
        try
        {
            var workloadId = WorkloadId.Parse(row.WorkloadId);
            var placementId = PlacementId.Parse(row.PlacementId);
            var expectedSubject = NativeNames.CreateServiceAccountSubject(
                placementId,
                workloadId);
            if (!string.Equals(
                    row.ServiceAccountSubject,
                    expectedSubject,
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "Stored Workload subject is invalid");
            }

            return new WorkloadRecord(
                workloadId,
                placementId,
                ParseDesiredState(row.DesiredState),
                new PackageComponentReference(
                    AppId.Parse(row.AppId),
                    ComponentId.Parse(row.ComponentId)),
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
                MapBehavior(row, interfaces),
                new AdmittedPackageComponent(
                    AppId.Parse(row.AppId),
                    Revision.FromStorage(row.AppRevision),
                    PackageId.Parse(row.PackageId),
                    Revision.FromStorage(row.PackageGeneration),
                    ComponentId.Parse(row.ComponentId),
                    ArtifactRepository.Parse(row.ArtifactRepository),
                    ManifestDigest.Parse(row.ArtifactManifestDigest)),
                interfaces
                    .OrderBy(item => item.InterfaceId)
                    .Select(item => new AdmittedInterface(
                        InterfaceId.Parse(item.InterfaceId),
                        ParseInterfaceProtocol(item.Protocol),
                        ContractId.Parse(item.ContractId),
                        item.Port,
                        item.ExposureId is null
                            ? null
                            : ExposureId.Parse(item.ExposureId),
                        item.EndpointHost is null
                            ? null
                            : EndpointHost.Parse(item.EndpointHost),
                        item.Ready))
                    .ToArray(),
                operations
                    .OrderBy(item => item.Operation, StringComparer.Ordinal)
                    .Select(item =>
                        OperationToken.FromStorage(item.Operation))
                    .ToArray(),
                row.ServiceAccountSubject,
                Revision.FromStorage(row.Revision),
                new RealizationStatus(
                    Revision.FromStorage(row.StatusRevision),
                    row.ObservedRevision,
                    Placements.PlacementRows.ParseRealizationPhase(
                        row.RealizationPhase),
                    Placements.PlacementRows.ParseRealizationReason(
                        row.RealizationReason),
                    UtcInstant.FromStorage(
                        row.StatusUpdatedAtUnixMs)),
                UtcInstant.FromStorage(row.CreatedAtUnixMs),
                UtcInstant.FromStorage(row.UpdatedAtUnixMs));
        }
        catch (Exception exception) when (
            exception is ArgumentException or InvalidOperationException
                or OverflowException)
        {
            throw new ExecutionException(
                ExecutionError.Unavailable,
                "Stored Workload state is invalid");
        }
    }

    private static AdmittedDependency MapDependency(
        WorkloadDependency row,
        IReadOnlyList<WorkloadDependencyParameter> parameters,
        IReadOnlyList<WorkloadDependencyOutput> outputs)
    {
        var componentId = ComponentId.Parse(row.ComponentId);
        var dependencyName = DependencyName.Parse(row.DependencyName);
        var matchingParameters = parameters
            .Where(item =>
                item.ComponentId == row.ComponentId
                && item.DependencyName == row.DependencyName)
            .OrderBy(item => item.ParameterName)
            .Select(item => new ProvisioningParameter(
                ParameterName.Parse(item.ParameterName),
                MapConfigTarget(item)))
            .ToArray();
        var matchingOutputs = outputs
            .Where(item =>
                item.ComponentId == row.ComponentId
                && item.DependencyName == row.DependencyName)
            .OrderBy(item => item.DataKind)
            .ThenBy(item => item.Purpose)
            .Select(MapConfigTarget)
            .ToArray();
        return new AdmittedDependency(
            new DependencySelection(
                componentId,
                dependencyName,
                row.DependencyId is null
                    ? null
                    : DependencyId.Parse(row.DependencyId),
                matchingParameters),
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
            matchingOutputs);
    }

    private static WorkloadBehavior MapBehavior(
        Workload row,
        IReadOnlyList<WorkloadInterface> interfaces) =>
        row.Mode switch
        {
            (int)WorkloadMode.Continuous
                when row.Replicas is not null
                    && row.ActorPrincipalId is null
                    && row.RunDurationSeconds is null
                    && row.MaxAttempts is null =>
                new WorkloadBehavior.Continuous(
                    row.Replicas.Value,
                    interfaces
                        .OrderBy(item => item.InterfaceId)
                        .Select(item =>
                            InterfaceId.Parse(item.InterfaceId))
                        .ToArray()),
            (int)WorkloadMode.Finite
                when row.Replicas is null
                    && row.RunDurationSeconds is not null
                    && row.MaxAttempts is not null =>
                new WorkloadBehavior.Finite(
                    row.ActorPrincipalId is null
                        ? null
                        : PrincipalId.Parse(row.ActorPrincipalId),
                    row.RunDurationSeconds.Value,
                    row.MaxAttempts.Value),
            _ => throw new InvalidOperationException(
                "Stored Workload behavior is invalid")
        };

    private static DesiredState ParseDesiredState(int value) =>
        Placements.PlacementRows.ParseDesiredState(value);

    private static InterfaceProtocol ParseInterfaceProtocol(int value) =>
        value switch
        {
            1 => InterfaceProtocol.Http,
            2 => InterfaceProtocol.Grpc,
            _ => throw new InvalidOperationException(
                "Stored interface protocol is invalid")
        };

    private static DependencyBindingPhase ParseBindingPhase(int value) =>
        value switch
        {
            1 => DependencyBindingPhase.Pending,
            2 => DependencyBindingPhase.Ready,
            3 => DependencyBindingPhase.Rejected,
            _ => throw new InvalidOperationException(
                "Stored dependency binding phase is invalid")
        };
}
