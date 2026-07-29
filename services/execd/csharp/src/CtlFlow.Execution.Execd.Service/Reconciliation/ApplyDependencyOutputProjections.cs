using CtlFlow.Configuration.V1;
using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.Execd.Service.Telemetry;
using static CtlFlow.Execution.Execd.Db.Reconciliation.ReconciliationState;
using static CtlFlow.Execution.Execd.Service.Configurations.ConfigurationProjection;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal static partial class ExecutionReconciliation
{
    internal static async Task ApplyDependencyOutputProjections(
        ExecutionDatabase database,
        ConfigurationService.ConfigurationServiceClient client,
        ConfigurationSettings settings,
        ExecdTelemetry telemetry,
        PlacementRecord placement,
        WorkloadRecord workload,
        AdmittedDependency dependency,
        CancellationToken cancellation)
    {
        foreach (var target in dependency.Outputs)
        {
            var resolved = await ApplyProjection(
                client,
                settings,
                telemetry,
                placement.Id,
                placement.Target,
                workload.Id,
                target.Target,
                cancellation);
            await UpdateDependencyOutputProjection(
                database,
                workload.Id,
                workload.Revision,
                dependency.Selection.ComponentId,
                dependency.Selection.Name,
                target.Target,
                resolved.ProjectionId!,
                resolved.ProjectionRevision!,
                cancellation);
        }
    }
}
