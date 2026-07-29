using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal static partial class ExecutionReconciliation
{
    internal static bool AllProjectionsAreResolved(
        WorkloadRecord workload) =>
        workload.ConfigTargets.All(IsResolved)
        && workload.Dependencies
            .SelectMany(item => item.Selection.Parameters)
            .All(item => IsResolved(item.Target))
        && workload.Dependencies
            .SelectMany(item => item.Outputs)
            .All(IsResolved);

    private static bool IsResolved(
        Domain.Configuration.ResolvedConfigTarget target) =>
        target.ProjectionId is not null
        && target.ProjectionRevision is not null;
}
