using CtlFlow.Execution.Execd.Domain.Auditing;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public static partial class Workloads
{
    public static async ValueTask<WorkloadDeclarationDecision>
        DecideWorkloadDeclaration(
            Workload? entity,
            WorkloadRecord? current,
            WorkloadDraft requested,
            PlacementTarget target,
            PlacementConstraints constraints,
            Revision? expectedRevision,
            bool hasNonterminalRun,
            bool persistentStorageIsBusy,
            AuditContext audit,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        EnsureProvisioners(requested, constraints);
        if (current is null)
        {
            if (expectedRevision is not null)
            {
                throw Aborted();
            }

            EnsureStorageAvailable(requested, persistentStorageIsBusy);
            var created = CreateRecord(
                requested,
                Revision.Initial(),
                RealizationStatus.Pending(audit.OccurredAt),
                audit.OccurredAt,
                audit.OccurredAt,
                null);
            return await CreateChanged(
                created,
                target,
                audit,
                true,
                null,
                cancellation);
        }

        if (current.PlacementId != requested.PlacementId)
        {
            throw Failed("Workload Placement is immutable");
        }

        // The admitted package identity is immutable for a Workload ID, so the
        // authority behind its derived ServiceAccount subject cannot change
        // while a Pod realized under that subject is still running. Adopting a
        // later generation is a new Workload ID and a new subject.
        if (current.AdmittedPackage.AppId
                != requested.AdmittedPackage.AppId
            || current.AdmittedPackage.PackageId
                != requested.AdmittedPackage.PackageId
            || current.AdmittedPackage.PackageGeneration
                != requested.AdmittedPackage.PackageGeneration
            || current.AdmittedPackage.ComponentId
                != requested.AdmittedPackage.ComponentId
            || !current.AdmittedOperations.SequenceEqual(
                requested.AdmittedOperations))
        {
            throw Failed("Workload package admission is immutable");
        }

        var equal = HasSameDeclaration(current, requested);
        if (expectedRevision is null)
        {
            if (equal)
            {
                return new WorkloadDeclarationDecision.Current(current);
            }

            throw new ExecutionException(
                ExecutionError.AlreadyExists,
                "Workload ID is already retained");
        }

        if (expectedRevision != current.Revision)
        {
            if (expectedRevision.Value < long.MaxValue
                && expectedRevision.Value + 1
                    == current.Revision.Value
                && equal)
            {
                return new WorkloadDeclarationDecision.Current(current);
            }

            throw Aborted();
        }

        if (equal)
        {
            return new WorkloadDeclarationDecision.Current(current);
        }

        if (current.DesiredState == DesiredState.Retired)
        {
            throw Failed("A retired Workload is immutable");
        }

        EnsureStorageTransition(current, requested);
        EnsureStorageAvailable(requested, persistentStorageIsBusy);
        if (requested.DesiredState == DesiredState.Retired
            && hasNonterminalRun)
        {
            throw Failed(
                "Workload retirement has active Runs");
        }

        var updated = CreateRecord(
            requested,
            current.Revision.Next(),
            current.Realization,
            current.CreatedAt,
            audit.OccurredAt,
            current);
        return await CreateChanged(
            updated,
            target,
            audit,
            false,
            entity,
            cancellation);
    }

    private static WorkloadRecord CreateRecord(
        WorkloadDraft requested,
        Revision revision,
        RealizationStatus realization,
        Time.UtcInstant createdAt,
        Time.UtcInstant updatedAt,
        WorkloadRecord? current) =>
        new(
            requested.Id,
            requested.PlacementId,
            requested.DesiredState,
            requested.PackageComponent,
            requested.Resources,
            requested.ConfigTargets,
            requested.Dependencies,
            requested.Storage,
            requested.Behavior,
            requested.AdmittedPackage,
            RetainInterfaceStatus(
                requested.Interfaces,
                current?.Interfaces ?? []),
            requested.AdmittedOperations,
            Naming.NativeNames.CreateServiceAccountSubject(
                requested.PlacementId,
                requested.Id),
            revision,
            realization,
            createdAt,
            updatedAt);

    private static IReadOnlyList<AdmittedInterface>
        RetainInterfaceStatus(
            IReadOnlyList<AdmittedInterface> requested,
            IReadOnlyList<AdmittedInterface> current)
    {
        var retained = current.ToDictionary(
            item => item.InterfaceId);
        return requested.Select(item =>
        {
            if (!retained.TryGetValue(
                    item.InterfaceId,
                    out var previous)
                || previous.Protocol != item.Protocol
                || previous.ContractId != item.ContractId
                || previous.Port != item.Port
                || previous.ExposureId != item.ExposureId)
            {
                return item with
                {
                    Host = null,
                    Ready = false
                };
            }

            return item with
            {
                Host = previous.Host,
                Ready = previous.Ready
            };
        }).ToArray();
    }

    private static async ValueTask<WorkloadDeclarationDecision>
        CreateChanged(
            WorkloadRecord workload,
            PlacementTarget target,
            AuditContext audit,
            bool isCreate,
            Workload? entity,
            CancellationToken cancellation)
    {
        var changed = entity ?? Workload.Restore(workload);
        if (entity is not null)
        {
            entity.Apply(workload);
        }

        var intent = await ExecutionAudits.CreateWorkloadAudit(
            workload,
            target,
            audit,
            cancellation);
        return new WorkloadDeclarationDecision.Changed(
            changed,
            workload,
            intent,
            isCreate);
    }

    private static void EnsureProvisioners(
        WorkloadDraft requested,
        PlacementConstraints constraints)
    {
        var provisioners = constraints.Provisioners.ToDictionary(
            item => item.DependencyType,
            item => item.ProvisionerId);
        foreach (var dependency in requested.Dependencies)
        {
            if (!provisioners.TryGetValue(
                    dependency.Type,
                    out var provisioner)
                || provisioner != dependency.ProvisionerId)
            {
                throw Failed(
                    "Dependency provisioner is not admitted");
            }
        }
    }

    private static void EnsureStorageTransition(
        WorkloadRecord current,
        WorkloadDraft requested)
    {
        if (requested.DesiredState == DesiredState.Retired)
        {
            return;
        }

        var requestedById = requested.Storage.ToDictionary(
            item => item.StorageId);
        foreach (var retained in current.Storage)
        {
            if (!requestedById.TryGetValue(
                    retained.StorageId,
                    out var replacement)
                || replacement.MountPath != retained.MountPath
                || replacement.CapacityBytes
                    != retained.CapacityBytes)
            {
                throw Failed(
                    "Storage cannot move, resize, or disappear");
            }
        }
    }

    private static void EnsureStorageAvailable(
        WorkloadDraft requested,
        bool persistentStorageIsBusy)
    {
        if (requested.DesiredState == DesiredState.Active
            && requested.Behavior is WorkloadBehavior.Continuous
            && requested.Storage.Count > 0
            && persistentStorageIsBusy)
        {
            throw new ExecutionException(
                ExecutionError.ResourceExhausted,
                "Persistent storage is in use");
        }
    }

    private static ExecutionException Aborted() =>
        new(
            ExecutionError.Aborted,
            "Workload revision changed");

    private static ExecutionException Failed(string message) =>
        new(ExecutionError.FailedPrecondition, message);
}
