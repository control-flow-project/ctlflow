using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.V1;
using Google.Protobuf.WellKnownTypes;
using DomainDesiredState =
    CtlFlow.Execution.Execd.Domain.Resources.DesiredState;
using DomainRealizationPhase =
    CtlFlow.Execution.Execd.Domain.Resources.RealizationPhase;
using DomainRealizationReason =
    CtlFlow.Execution.Execd.Domain.Resources.RealizationReason;
using WireDesiredState =
    CtlFlow.Execution.V1.DesiredState;
using WireRealizationPhase =
    CtlFlow.Execution.V1.RealizationPhase;
using WireRealizationReason =
    CtlFlow.Execution.V1.RealizationReason;
using WirePlacementConstraints =
    CtlFlow.Execution.V1.PlacementConstraints;
using WireRealizationStatus =
    CtlFlow.Execution.V1.RealizationStatus;
using WireWorkloadMode =
    CtlFlow.Execution.V1.WorkloadMode;
using WireDependencyProvisionerSelection =
    CtlFlow.Execution.V1.DependencyProvisionerSelection;
using WirePlacement = CtlFlow.Execution.V1.Placement;

namespace CtlFlow.Execution.Execd.Service.Grpc.Responses;

internal static partial class ExecutionResponses
{
    internal static ValueTask<WirePlacement> CreatePlacementResponse(
        PlacementRecord placement,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var response = new WirePlacement
        {
            PlacementId = placement.Id.Value,
            Target = CreatePlacementTargetResponse(placement.Target),
            Constraints = CreateConstraintsResponse(
                placement.Constraints),
            DesiredState = MapState(placement.DesiredState),
            Revision = checked((ulong)placement.Revision.Value),
            Realization = CreateRealizationResponse(
                placement.Realization),
            CreatedAt = Timestamp.FromDateTimeOffset(
                placement.CreatedAt.Value),
            UpdatedAt = Timestamp.FromDateTimeOffset(
                placement.UpdatedAt.Value)
        };
        if (placement.ParentId is not null)
        {
            response.ParentPlacementId = placement.ParentId.Value;
        }

        return ValueTask.FromResult(response);
    }

    private static WirePlacementConstraints CreateConstraintsResponse(
        CtlFlow.Execution.Execd.Domain.Placements.PlacementConstraints
            constraints)
    {
        var response = new WirePlacementConstraints
        {
            MaxReplicasPerContinuousWorkload =
                checked((uint)constraints.MaxReplicas),
            MaxRunDurationSeconds =
                checked((ulong)constraints.MaxRunDurationSeconds),
            MaxRunAttempts = checked(
                (uint)constraints.MaxRunAttempts),
            MaxResourcesPerExecution = new ExecutionResources
            {
                CpuMillis = checked((uint)constraints.MaxCpuMillis),
                MemoryBytes = checked(
                    (ulong)constraints.MaxMemoryBytes)
            },
            MaxPersistentStorageBytesPerWorkload =
                checked((ulong)constraints.MaxStorageBytes)
        };
        if (constraints.AdmitContinuous)
        {
            response.AdmittedModes.Add(WireWorkloadMode.Continuous);
        }

        if (constraints.AdmitFinite)
        {
            response.AdmittedModes.Add(WireWorkloadMode.Finite);
        }

        response.DependencyProvisioners.AddRange(
            constraints.Provisioners.Select(item =>
                new WireDependencyProvisionerSelection
                {
                    DependencyTypeId =
                        item.DependencyType.Value,
                    ProvisionerId = item.ProvisionerId.Value
                }));
        return response;
    }

    internal static WireRealizationStatus CreateRealizationResponse(
        CtlFlow.Execution.Execd.Domain.Resources.RealizationStatus
            realization) =>
        new()
        {
            StatusRevision = checked(
                (ulong)realization.StatusRevision.Value),
            ObservedRevision = checked(
                (ulong)realization.ObservedRevision),
            Phase = realization.Phase switch
            {
                DomainRealizationPhase.Pending =>
                    WireRealizationPhase.Pending,
                DomainRealizationPhase.Ready =>
                    WireRealizationPhase.Ready,
                DomainRealizationPhase.Suspended =>
                    WireRealizationPhase.Suspended,
                DomainRealizationPhase.Degraded =>
                    WireRealizationPhase.Degraded,
                DomainRealizationPhase.Retired =>
                    WireRealizationPhase.Retired,
                _ => throw new InvalidOperationException(
                    "Realization phase is invalid")
            },
            Reason = realization.Reason switch
            {
                DomainRealizationReason.None =>
                    WireRealizationReason.None,
                DomainRealizationReason.PlacementNotReady =>
                    WireRealizationReason.PlacementNotReady,
                DomainRealizationReason.BindingUnavailable =>
                    WireRealizationReason.BindingUnavailable,
                DomainRealizationReason.KubernetesUnavailable =>
                    WireRealizationReason.KubernetesUnavailable,
                DomainRealizationReason.RealizationRejected =>
                    WireRealizationReason.RealizationRejected,
                DomainRealizationReason.OwnershipConflict =>
                    WireRealizationReason.OwnershipConflict,
                DomainRealizationReason.StorageUnavailable =>
                    WireRealizationReason.StorageUnavailable,
                DomainRealizationReason.ExecutionUnready =>
                    WireRealizationReason.ExecutionUnready,
                _ => throw new InvalidOperationException(
                    "Realization reason is invalid")
            },
            UpdatedAt = Timestamp.FromDateTimeOffset(
                realization.UpdatedAt.Value)
        };

    internal static WireDesiredState MapState(
        DomainDesiredState state) =>
        state switch
        {
            DomainDesiredState.Active => WireDesiredState.Active,
            DomainDesiredState.Suspended =>
                WireDesiredState.Suspended,
            DomainDesiredState.Retired => WireDesiredState.Retired,
            _ => throw new InvalidOperationException(
                "Desired state is invalid")
        };
}
