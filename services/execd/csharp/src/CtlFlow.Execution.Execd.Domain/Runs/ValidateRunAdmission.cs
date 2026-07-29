using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Domain.Runs;

public static partial class Runs
{
    public static async ValueTask ValidateRunAdmission(
        WorkloadRecord workload,
        IReadOnlyList<PlacementRecord> placementLineage,
        bool persistentStorageIsBusy,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (workload.DesiredState != DesiredState.Active
            || workload.Behavior is not WorkloadBehavior.Finite
            || workload.Realization.Phase != RealizationPhase.Ready
            || workload.Realization.ObservedRevision
                != workload.Revision.Value)
        {
            throw new ExecutionException(
                ExecutionError.FailedPrecondition,
                "Run requires an active ready finite Workload");
        }

        if (placementLineage.Count == 0
            || placementLineage[0].Id != workload.PlacementId)
        {
            throw new InvalidOperationException(
                "Placement lineage does not contain the Workload");
        }

        if (!await Domain.Placements.Placements
                .IsPlacementEffectivelyActive(
                    placementLineage,
                    cancellation))
        {
            throw new ExecutionException(
                ExecutionError.FailedPrecondition,
                "Placement is not effectively active");
        }

        if (persistentStorageIsBusy)
        {
            throw new ExecutionException(
                ExecutionError.ResourceExhausted,
                "Persistent storage is in use");
        }

        if (workload.ConfigTargets.Any(item =>
                item.ProjectionId is null
                || item.ProjectionRevision is null)
            || workload.Dependencies.Any(item =>
                item.BindingPhase != DependencyBindingPhase.Ready
                || item.BindingId is null
                || item.BindingRevision is null)
            || workload.Dependencies
                .SelectMany(item => item.Selection.Parameters)
                .Any(item =>
                    item.Target.ProjectionId is null
                    || item.Target.ProjectionRevision is null)
            || workload.Dependencies
                .SelectMany(item => item.Outputs)
                .Any(item =>
                    item.ProjectionId is null
                    || item.ProjectionRevision is null))
        {
            throw new ExecutionException(
                ExecutionError.Unavailable,
                "Run snapshot dependencies are unresolved");
        }

    }
}
