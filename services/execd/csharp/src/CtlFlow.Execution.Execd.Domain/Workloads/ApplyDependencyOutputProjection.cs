using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public static partial class Workloads
{
    public static ValueTask<ResolvedConfigTarget?>
        ApplyDependencyOutputProjection(
            WorkloadRecord current,
            Revision expectedRevision,
            ComponentId componentId,
            DependencyName dependencyName,
            ConfigTargetReference target,
            ProjectionId projectionId,
            Revision projectionRevision,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (current.Revision != expectedRevision)
        {
            return ValueTask.FromResult<ResolvedConfigTarget?>(null);
        }

        var dependency = current.Dependencies.SingleOrDefault(
            item =>
                item.Selection.ComponentId == componentId
                && item.Selection.Name == dependencyName);
        var retained = dependency?.Outputs.SingleOrDefault(
            item =>
                item.Target.Kind == target.Kind
                && item.Target.Purpose == target.Purpose);
        if (retained is null || retained.Target != target)
        {
            return ValueTask.FromResult<ResolvedConfigTarget?>(null);
        }

        return ValueTask.FromResult<ResolvedConfigTarget?>(
            retained with
            {
                ProjectionId = projectionId,
                ProjectionRevision = projectionRevision
            });
    }
}
