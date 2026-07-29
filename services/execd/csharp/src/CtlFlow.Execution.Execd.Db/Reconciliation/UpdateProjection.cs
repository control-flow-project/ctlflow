using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Reconciliation;

public static partial class ReconciliationState
{
    public static async Task UpdateProjection(
        ExecutionDatabase database,
        WorkloadId workloadId,
        Revision expectedWorkloadRevision,
        ComponentId? componentId,
        DependencyName? dependencyName,
        ParameterName? parameterName,
        ConfigTargetReference target,
        ProjectionId projectionId,
        Revision projectionRevision,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "update_projection");
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

        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        if (componentId is null)
        {
            var updated = await Domain.Workloads.Workloads
                .ApplyConfigProjection(
                    current,
                    expectedWorkloadRevision,
                    target,
                    projectionId,
                    projectionRevision,
                    cancellation);
            if (updated is null)
            {
                return;
            }

            var row = new WorkloadConfigTarget
            {
                WorkloadId = workloadId.Value,
                DataKind = (int)target.Kind,
                Purpose = target.Purpose.Value,
                ProjectionId = updated.ProjectionId?.Value,
                ProjectionRevision =
                    updated.ProjectionRevision?.Value
            };
            context.Attach(row);
            context.Entry(row)
                .Property(item => item.ProjectionId)
                .IsModified = true;
            context.Entry(row)
                .Property(item => item.ProjectionRevision)
                .IsModified = true;
        }
        else
        {
            var updated = await Domain.Workloads.Workloads
                .ApplyDependencyParameterProjection(
                    current,
                    expectedWorkloadRevision,
                    componentId,
                    dependencyName!,
                    parameterName!,
                    target,
                    projectionId,
                    projectionRevision,
                    cancellation);
            if (updated is null)
            {
                return;
            }

            var row = new WorkloadDependencyParameter
            {
                WorkloadId = workloadId.Value,
                ComponentId = componentId.Value,
                DependencyName = dependencyName!.Value,
                ParameterName = parameterName!.Value,
                ProjectionId = updated.ProjectionId?.Value,
                ProjectionRevision =
                    updated.ProjectionRevision?.Value
            };
            context.Attach(row);
            context.Entry(row)
                .Property(item => item.ProjectionId)
                .IsModified = true;
            context.Entry(row)
                .Property(item => item.ProjectionRevision)
                .IsModified = true;
        }

        await context.SaveChangesAsync(cancellation);
    }
}
