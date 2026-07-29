using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Reconciliation;

public static partial class ReconciliationState
{
    public static async Task UpdateDependencyBinding(
        ExecutionDatabase database,
        WorkloadId workloadId,
        Revision expectedWorkloadRevision,
        ComponentId componentId,
        DependencyName dependencyName,
        Revision claimRevision,
        long observedClaimRevision,
        DependencyBindingPhase phase,
        BindingId? bindingId,
        Revision? bindingRevision,
        IReadOnlyList<ConfigTargetReference> outputs,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "update_dependency_binding");
        await using var lease =
            await database.AcquireMutation(cancellation);
        var current = await Db.Workloads.Workloads.LoadWorkload(
            database,
            workloadId,
            cancellation);
        if (current is null)
        {
            return;
        }

        var updated = await Domain.Workloads.Workloads
            .ApplyDependencyBinding(
                current,
                expectedWorkloadRevision,
                componentId,
                dependencyName,
                claimRevision,
                observedClaimRevision,
                phase,
                bindingId,
                bindingRevision,
                outputs,
                cancellation);
        if (updated is null)
        {
            return;
        }

        var retained = current.Dependencies.Single(
            item =>
                item.Selection.ComponentId == componentId
                && item.Selection.Name == dependencyName);
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var row = new WorkloadDependency
        {
            WorkloadId = workloadId.Value,
            ComponentId = componentId.Value,
            DependencyName = dependencyName.Value,
            ObservedClaimRevision = updated.ObservedClaimRevision,
            BindingPhase = (int)updated.BindingPhase,
            BindingId = updated.BindingId?.Value,
            BindingRevision = updated.BindingRevision?.Value
        };
        context.Attach(row);
        MarkBindingModified(context, row);
        SynchronizeOutputs(
            context,
            workloadId,
            componentId,
            dependencyName,
            retained.Outputs,
            updated.Outputs);
        await context.SaveChangesAsync(cancellation);
    }

    private static void MarkBindingModified(
        ExecutionDbContext context,
        WorkloadDependency row)
    {
        context.Entry(row)
            .Property(item => item.ObservedClaimRevision)
            .IsModified = true;
        context.Entry(row)
            .Property(item => item.BindingPhase)
            .IsModified = true;
        context.Entry(row)
            .Property(item => item.BindingId)
            .IsModified = true;
        context.Entry(row)
            .Property(item => item.BindingRevision)
            .IsModified = true;
    }

    private static void SynchronizeOutputs(
        ExecutionDbContext context,
        WorkloadId workloadId,
        ComponentId componentId,
        DependencyName dependencyName,
        IReadOnlyList<ResolvedConfigTarget> current,
        IReadOnlyList<ResolvedConfigTarget> updated)
    {
        var currentByKey = current.ToDictionary(
            item => (item.Target.Kind, item.Target.Purpose));
        var updatedByKey = updated.ToDictionary(
            item => (item.Target.Kind, item.Target.Purpose));
        foreach (var removed in currentByKey
            .Where(item => !updatedByKey.ContainsKey(item.Key)))
        {
            context.Remove(CreateOutputRow(
                workloadId,
                componentId,
                dependencyName,
                removed.Value));
        }

        foreach (var item in updatedByKey)
        {
            var row = CreateOutputRow(
                workloadId,
                componentId,
                dependencyName,
                item.Value);
            if (!currentByKey.ContainsKey(item.Key))
            {
                context.Add(row);
                continue;
            }

            context.Attach(row);
            context.Entry(row)
                .Property(output => output.TargetId)
                .IsModified = true;
            context.Entry(row)
                .Property(output => output.TargetVersionId)
                .IsModified = true;
            context.Entry(row)
                .Property(output => output.ProjectionId)
                .IsModified = true;
            context.Entry(row)
                .Property(output => output.ProjectionRevision)
                .IsModified = true;
        }
    }

    private static WorkloadDependencyOutput CreateOutputRow(
        WorkloadId workloadId,
        ComponentId componentId,
        DependencyName dependencyName,
        ResolvedConfigTarget output) =>
        new()
        {
            WorkloadId = workloadId.Value,
            ComponentId = componentId.Value,
            DependencyName = dependencyName.Value,
            DataKind = (int)output.Target.Kind,
            Purpose = output.Target.Purpose.Value,
            TargetId = output.Target.TargetId,
            TargetVersionId = output.Target.VersionId,
            ProjectionId = output.ProjectionId?.Value,
            ProjectionRevision = output.ProjectionRevision?.Value
        };
}
