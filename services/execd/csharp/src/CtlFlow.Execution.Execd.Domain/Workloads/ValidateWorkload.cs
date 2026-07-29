using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public static partial class Workloads
{
    public static ValueTask ValidateWorkload(
        Revision currentPlacementRevision,
        Revision expectedPlacementRevision,
        PlacementTarget target,
        PlacementConstraints constraints,
        ExecutionResources resources,
        IReadOnlyList<ConfigTargetReference> targets,
        IReadOnlyList<DependencySelection> dependencies,
        IReadOnlyList<PersistentStorage> storage,
        WorkloadBehavior behavior,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (currentPlacementRevision != expectedPlacementRevision)
        {
            throw new ExecutionException(
                ExecutionError.Aborted,
                "Placement revision changed");
        }

        if (resources.CpuMillis > constraints.MaxCpuMillis
            || resources.MemoryBytes > constraints.MaxMemoryBytes)
        {
            throw AdmissionFailed(
                "Execution resources exceed Placement constraints");
        }

        if (targets.Count > ExecutionLimits.MaximumTargets
            || dependencies.Count > ExecutionLimits.MaximumDependencies
            || storage.Count > ExecutionLimits.MaximumStorageSlots
            || dependencies.Any(item =>
                item.Parameters.Count > ExecutionLimits.MaximumParameters))
        {
            throw new ExecutionException(
                ExecutionError.InvalidArgument,
                "Workload collection bound is exceeded");
        }

        EnsureUniqueTargets(targets);
        EnsureUniqueDependencies(dependencies);
        EnsureStorage(storage, constraints);

        switch (behavior)
        {
            case WorkloadBehavior.Continuous continuous:
                if (!constraints.AdmitContinuous
                    || continuous.Replicas is < 1
                        or > ExecutionLimits.MaximumReplicas
                    || continuous.Replicas > constraints.MaxReplicas
                    || continuous.InterfaceIds.Count
                        > ExecutionLimits.MaximumInterfaces
                    || continuous.InterfaceIds.Distinct().Count()
                        != continuous.InterfaceIds.Count
                    || storage.Count > 0 && continuous.Replicas != 1)
                {
                    throw AdmissionFailed(
                        "Continuous behavior is not admitted");
                }

                break;

            case WorkloadBehavior.Finite finite:
                if (!constraints.AdmitFinite
                    || finite.RunDurationSeconds is < 1
                        or > ExecutionLimits.MaximumRunDurationSeconds
                    || finite.RunDurationSeconds
                        > constraints.MaxRunDurationSeconds
                    || finite.MaxAttempts is < 1
                        or > ExecutionLimits.MaximumRunAttempts
                    || finite.MaxAttempts > constraints.MaxRunAttempts
                    || target is PlacementTarget.Global
                        && finite.ActorPrincipalId is not null
                    || target is not PlacementTarget.Global
                        && finite.ActorPrincipalId is null)
                {
                    throw AdmissionFailed(
                        "Finite behavior is not admitted");
                }

                break;

            default:
                throw new ExecutionException(
                    ExecutionError.InvalidArgument,
                    "Workload behavior is invalid");
        }

        return ValueTask.CompletedTask;
    }

    private static void EnsureUniqueTargets(
        IReadOnlyList<ConfigTargetReference> targets)
    {
        if (targets
            .Select(item => (item.Kind, item.Purpose))
            .Distinct()
            .Count() != targets.Count)
        {
            throw new ExecutionException(
                ExecutionError.InvalidArgument,
                "Direct Configd targets must be unique by kind and purpose");
        }
    }

    private static void EnsureUniqueDependencies(
        IReadOnlyList<DependencySelection> dependencies)
    {
        if (dependencies
            .Select(item => (item.ComponentId, item.Name))
            .Distinct()
            .Count() != dependencies.Count)
        {
            throw new ExecutionException(
                ExecutionError.InvalidArgument,
                "Dependencies must be unique by component and name");
        }

        foreach (var dependency in dependencies)
        {
            if (dependency.Parameters
                .Select(item => item.Name)
                .Distinct()
                .Count() != dependency.Parameters.Count)
            {
                throw new ExecutionException(
                    ExecutionError.InvalidArgument,
                    "Dependency parameter names must be unique");
            }
        }
    }

    private static void EnsureStorage(
        IReadOnlyList<PersistentStorage> storage,
        PlacementConstraints constraints)
    {
        if (storage.Select(item => item.StorageId).Distinct().Count()
                != storage.Count
            || storage.Any(item =>
                item.CapacityBytes is < 1
                    or > ExecutionLimits.MaximumStorageBytes)
            || storage.Sum(item => item.CapacityBytes)
                > constraints.MaxStorageBytes)
        {
            throw AdmissionFailed(
                "Persistent storage is not admitted");
        }

        for (var left = 0; left < storage.Count; left++)
        {
            for (var right = left + 1; right < storage.Count; right++)
            {
                var leftPath = storage[left].MountPath.Value;
                var rightPath = storage[right].MountPath.Value;
                if (leftPath.Equals(rightPath, StringComparison.Ordinal)
                    || leftPath.StartsWith($"{rightPath}/", StringComparison.Ordinal)
                    || rightPath.StartsWith($"{leftPath}/", StringComparison.Ordinal))
                {
                    throw AdmissionFailed(
                        "Persistent storage paths overlap");
                }
            }
        }
    }

    private static ExecutionException AdmissionFailed(string message) =>
        new(ExecutionError.FailedPrecondition, message);
}
