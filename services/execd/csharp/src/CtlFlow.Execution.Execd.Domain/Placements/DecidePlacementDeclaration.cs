using CtlFlow.Execution.Execd.Domain.Auditing;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Domain.Placements;

public static partial class Placements
{
    public static async ValueTask<PlacementDeclarationDecision>
        DecidePlacementDeclaration(
            Placement? entity,
            PlacementRecord? current,
            PlacementId placementId,
            PlacementTarget target,
            PlacementId? parentId,
            PlacementConstraints constraints,
            DesiredState desiredState,
            Revision? expectedRevision,
            PlacementUpdateFacts facts,
            AuditContext audit,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (current is null)
        {
            if (expectedRevision is not null)
            {
                throw Aborted();
            }

            var created = new PlacementRecord(
                placementId,
                target,
                parentId,
                constraints,
                desiredState,
                Revision.Initial(),
                RealizationStatus.Pending(audit.OccurredAt),
                audit.OccurredAt,
                audit.OccurredAt);
            return await CreateChanged(
                created,
                audit,
                true,
                null,
                cancellation);
        }

        if (current.Target != target || current.ParentId != parentId)
        {
            throw Failed("Placement target and parent are immutable");
        }

        var equal = HaveSameConstraints(
                current.Constraints,
                constraints)
            && current.DesiredState == desiredState;
        if (expectedRevision is null)
        {
            if (equal)
            {
                return new PlacementDeclarationDecision.Current(current);
            }

            throw new ExecutionException(
                ExecutionError.AlreadyExists,
                "Placement ID is already retained");
        }

        if (expectedRevision != current.Revision)
        {
            if (expectedRevision.Next() == current.Revision && equal)
            {
                return new PlacementDeclarationDecision.Current(current);
            }

            throw Aborted();
        }

        if (equal)
        {
            return new PlacementDeclarationDecision.Current(current);
        }

        if (current.DesiredState == DesiredState.Retired)
        {
            throw Failed("A retired Placement is immutable");
        }

        EnsureChildrenRemainValid(constraints, facts);
        if (desiredState == DesiredState.Retired
            && (facts.ActiveChildren.Count > 0
                || facts.ActiveWorkloads.Count > 0
                || facts.HasNonterminalRun))
        {
            throw Failed("Placement retirement has lifecycle blockers");
        }

        var updated = current with
        {
            Constraints = constraints,
            DesiredState = desiredState,
            Revision = current.Revision.Next(),
            UpdatedAt = audit.OccurredAt
        };
        return await CreateChanged(
            updated,
            audit,
            false,
            entity,
            cancellation);
    }

    private static async ValueTask<PlacementDeclarationDecision>
        CreateChanged(
            PlacementRecord placement,
            AuditContext audit,
            bool isCreate,
            Placement? entity,
            CancellationToken cancellation)
    {
        var changed = entity ?? Placement.Restore(placement);
        if (entity is not null)
        {
            entity.Apply(placement);
        }

        var intent = await ExecutionAudits.CreatePlacementAudit(
            placement,
            audit,
            cancellation);
        return new PlacementDeclarationDecision.Changed(
            changed,
            placement,
            intent,
            isCreate);
    }

    private static void EnsureChildrenRemainValid(
        PlacementConstraints constraints,
        PlacementUpdateFacts facts)
    {
        foreach (var child in facts.ActiveChildren)
        {
            child.Constraints.EnsureNarrows(constraints);
        }

        foreach (var workload in facts.ActiveWorkloads)
        {
            ValidateWorkload(
                workload,
                constraints);
        }
    }

    private static void ValidateWorkload(
        WorkloadRecord workload,
        PlacementConstraints constraints)
    {
        if (workload.Resources.CpuMillis > constraints.MaxCpuMillis
            || workload.Resources.MemoryBytes > constraints.MaxMemoryBytes
            || workload.Behavior is WorkloadBehavior.Continuous continuous
                && (!constraints.AdmitContinuous
                    || continuous.Replicas > constraints.MaxReplicas)
            || workload.Behavior is WorkloadBehavior.Finite finite
                && (!constraints.AdmitFinite
                    || finite.RunDurationSeconds
                        > constraints.MaxRunDurationSeconds
                    || finite.MaxAttempts > constraints.MaxRunAttempts)
            || workload.Storage.Sum(item => item.CapacityBytes)
                > constraints.MaxStorageBytes)
        {
            throw Failed(
                "Placement update would invalidate a Workload");
        }

        var provisioners = constraints.Provisioners.ToDictionary(
            item => item.DependencyType,
            item => item.ProvisionerId);
        foreach (var dependency in workload.Dependencies)
        {
            if (!provisioners.TryGetValue(
                    dependency.Type,
                    out var provisioner)
                || provisioner != dependency.ProvisionerId)
            {
                throw Failed(
                    "Placement update would invalidate a dependency");
            }
        }
    }

    private static ExecutionException Aborted() =>
        new(
            ExecutionError.Aborted,
            "Placement revision changed");

    private static ExecutionException Failed(string message) =>
        new(ExecutionError.FailedPrecondition, message);
}
