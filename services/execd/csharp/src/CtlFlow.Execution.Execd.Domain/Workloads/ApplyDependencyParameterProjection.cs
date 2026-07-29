using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public static partial class Workloads
{
    public static ValueTask<ResolvedConfigTarget?>
        ApplyDependencyParameterProjection(
            WorkloadRecord current,
            Revision expectedRevision,
            ComponentId componentId,
            DependencyName dependencyName,
            ParameterName parameterName,
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
        var parameter = dependency?.Selection.Parameters.SingleOrDefault(
            item => item.Name == parameterName);
        if (parameter is null || parameter.Target.Target != target)
        {
            return ValueTask.FromResult<ResolvedConfigTarget?>(null);
        }

        return ValueTask.FromResult<ResolvedConfigTarget?>(
            parameter.Target with
            {
                ProjectionId = projectionId,
                ProjectionRevision = projectionRevision
            });
    }
}
