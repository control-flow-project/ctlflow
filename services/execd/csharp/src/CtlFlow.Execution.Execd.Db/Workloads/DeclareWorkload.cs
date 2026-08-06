using CtlFlow.Execution.Execd.Domain.Auditing;
using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Execution.Execd.Db.Placements.Placements;
using static CtlFlow.Execution.Execd.Db.Workloads.WorkloadRows;

namespace CtlFlow.Execution.Execd.Db.Workloads;

public static partial class Workloads
{
    public static async Task<MutationResult<WorkloadRecord>>
        DeclareWorkload(
            ExecutionDatabase database,
            WorkloadDraft draft,
            WorkloadWriteContent content,
            Revision placementRevision,
            Revision? expectedRevision,
            AuditContext audit,
            CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "declare_workload");
        await using var lease =
            await database.AcquireMutation(cancellation);
        var placement = await LoadPlacement(
            database,
            draft.PlacementId,
            cancellation)
            ?? throw new ExecutionException(
                ExecutionError.NotFound,
                "Placement was not found");
        await Domain.Workloads.Workloads.ValidateWorkload(
            placement.Revision,
            placementRevision,
            placement.Target,
            placement.Constraints,
            draft.Resources,
            draft.ConfigTargets.Select(item => item.Target)
                .ToArray(),
            draft.Dependencies.Select(item => item.Selection)
                .ToArray(),
            draft.Storage,
            draft.Behavior,
            cancellation);
        var current = await LoadWorkload(
            database,
            draft.Id,
            cancellation);

        var dependencies = await PrepareDependencies(
            draft.Dependencies,
            current?.Dependencies ?? [],
            content,
            cancellation);
        var admitted = draft with
        {
            Dependencies = dependencies
        };
        var hasNonterminalRun = current is not null
            && await HasNonterminalRun(
                database,
                draft.Id,
                cancellation);
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        Workload? entity = null;
        if (current is not null)
        {
            entity = Workload.Restore(current);
            context.Attach(entity);
        }

        var decision = await Domain.Workloads.Workloads
            .DecideWorkloadDeclaration(
                entity,
                current,
                admitted,
                placement.Target,
                placement.Constraints,
                expectedRevision,
                hasNonterminalRun,
                audit,
                cancellation);
        if (decision is WorkloadDeclarationDecision.Current retained)
        {
            return new MutationResult<WorkloadRecord>(
                retained.Workload,
                null);
        }

        var changed = decision as WorkloadDeclarationDecision.Changed
            ?? throw new InvalidOperationException(
                "Workload declaration decision is invalid");
        var changedDraft = CreateWorkloadDraft(changed.Workload);
        await using var transaction =
            await context.Database.BeginTransactionAsync(cancellation);
        if (changed.IsCreate)
        {
            context.Workloads.Add(changed.Entity);
            AddChildren(context, changedDraft, content);
            AddOperations(context, changedDraft);
        }
        else
        {
            RemoveChildren(context, current!);
            await context.SaveChangesAsync(cancellation);
            AddChildren(context, changedDraft, content);
        }

        await context.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
        return new MutationResult<WorkloadRecord>(
            changed.Workload,
            changed.Audit);
    }

    private static void AddChildren(
        ExecutionDbContext context,
        WorkloadDraft draft,
        WorkloadWriteContent content)
    {
        context.WorkloadConfigTargets.AddRange(
            CreateConfigTargetRows(draft));
        context.WorkloadDependencies.AddRange(
            CreateDependencyRows(draft, content));
        context.WorkloadDependencyParameters.AddRange(
            CreateParameterRows(draft));
        context.WorkloadDependencyOutputs.AddRange(
            CreateOutputRows(draft));
        context.WorkloadStorage.AddRange(
            CreateStorageRows(draft));
        context.WorkloadInterfaces.AddRange(CreateInterfaceRows(draft));
    }

    private static void AddOperations(
        ExecutionDbContext context,
        WorkloadDraft draft)
    {
        context.WorkloadOperations.AddRange(
            draft.AdmittedOperations.Select(operation =>
                new WorkloadOperation
                {
                    WorkloadId = draft.Id.Value,
                    Operation = operation.Value
                }));
    }

    private static void RemoveChildren(
        ExecutionDbContext context,
        WorkloadRecord workload)
    {
        var id = workload.Id.Value;
        context.WorkloadDependencyOutputs.RemoveRange(
            workload.Dependencies.SelectMany(dependency =>
                dependency.Outputs.Select(output =>
                    new WorkloadDependencyOutput
                    {
                        WorkloadId = id,
                        ComponentId =
                            dependency.Selection.ComponentId.Value,
                        DependencyName =
                            dependency.Selection.Name.Value,
                        DataKind = (int)output.Target.Kind,
                        Purpose = output.Target.Purpose.Value
                    })));
        context.WorkloadDependencyParameters.RemoveRange(
            workload.Dependencies.SelectMany(dependency =>
                dependency.Selection.Parameters.Select(parameter =>
                    new WorkloadDependencyParameter
                    {
                        WorkloadId = id,
                        ComponentId =
                            dependency.Selection.ComponentId.Value,
                        DependencyName =
                            dependency.Selection.Name.Value,
                        ParameterName = parameter.Name.Value
                    })));
        context.WorkloadDependencies.RemoveRange(
            workload.Dependencies.Select(dependency =>
                new WorkloadDependency
                {
                    WorkloadId = id,
                    ComponentId =
                        dependency.Selection.ComponentId.Value,
                    DependencyName =
                        dependency.Selection.Name.Value
                }));
        context.WorkloadConfigTargets.RemoveRange(
            workload.ConfigTargets.Select(target =>
                new WorkloadConfigTarget
                {
                    WorkloadId = id,
                    DataKind = (int)target.Target.Kind,
                    Purpose = target.Target.Purpose.Value
                }));
        context.WorkloadStorage.RemoveRange(
            workload.Storage.Select(storage =>
                new WorkloadStorage
                {
                    WorkloadId = id,
                    StorageId = storage.StorageId.Value
                }));
        context.WorkloadInterfaces.RemoveRange(
            workload.Interfaces.Select(item =>
                new WorkloadInterface
                {
                    WorkloadId = id,
                    InterfaceId = item.InterfaceId.Value
                }));
    }

    private static async Task<bool> HasNonterminalRun(
        ExecutionDatabase database,
        WorkloadId workloadId,
        CancellationToken cancellation)
    {
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var workloadIdValue = workloadId.Value;
        var succeeded = (int)RunPhase.Succeeded;
        var failed = (int)RunPhase.Failed;
        var cancelled = (int)RunPhase.Cancelled;
        var queryCancellation = cancellation;
        var rows = await context.Runs
            .AsNoTracking()
            .Where(item =>
                    EF.Property<string>(item, "WorkloadId")
                        == workloadIdValue
                    && EF.Property<int>(item, "Phase") != succeeded
                    && EF.Property<int>(item, "Phase") != failed
                    && EF.Property<int>(item, "Phase") != cancelled)
            .Select(item => new
            {
                RunId = EF.Property<string>(item, "RunId")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        return rows.Count != 0;
    }

    private static WorkloadDraft CreateWorkloadDraft(
        WorkloadRecord workload) =>
        new(
            workload.Id,
            workload.PlacementId,
            workload.DesiredState,
            workload.PackageComponent,
            workload.Resources,
            workload.ConfigTargets,
            workload.Dependencies,
            workload.Storage,
            workload.Behavior,
            workload.AdmittedPackage,
            workload.Interfaces,
            workload.AdmittedOperations);
}
