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
    internal static async Task ApplyWorkloadProjections(
        ExecutionDatabase database,
        ConfigurationService.ConfigurationServiceClient client,
        ConfigurationSettings settings,
        ExecdTelemetry telemetry,
        PlacementRecord placement,
        WorkloadRecord workload,
        CancellationToken cancellation)
    {
        foreach (var target in workload.ConfigTargets)
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
            await UpdateProjection(
                database,
                workload.Id,
                workload.Revision,
                null,
                null,
                null,
                target.Target,
                resolved.ProjectionId!,
                resolved.ProjectionRevision!,
                cancellation);
        }

        foreach (var dependency in workload.Dependencies)
        {
            foreach (var parameter in dependency.Selection.Parameters)
            {
                var resolved = await ApplyProjection(
                    client,
                    settings,
                    telemetry,
                    placement.Id,
                    placement.Target,
                    workload.Id,
                    parameter.Target.Target,
                    cancellation);
                await UpdateProjection(
                    database,
                    workload.Id,
                    workload.Revision,
                    dependency.Selection.ComponentId,
                    dependency.Selection.Name,
                    parameter.Name,
                    parameter.Target.Target,
                    resolved.ProjectionId!,
                    resolved.ProjectionRevision!,
                    cancellation);
            }
        }
    }
}
