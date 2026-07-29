using CtlFlow.Configuration.V1;
using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.Execd.Service.Kubernetes;
using CtlFlow.Execution.Execd.Service.Telemetry;
using static CtlFlow.Execution.Execd.Db.Reconciliation.ReconciliationState;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesApis;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesBodies;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal static partial class ExecutionReconciliation
{
    internal static async Task<bool> ReconcileDependency(
        ExecutionDatabase database,
        KubernetesApi kubernetes,
        ConfigurationService.ConfigurationServiceClient configClient,
        ConfigurationSettings configSettings,
        ExecdTelemetry telemetry,
        PlacementRecord placement,
        WorkloadRecord workload,
        AdmittedDependency dependency,
        string namespaceName,
        CancellationToken cancellation)
    {
        using var options = await ReadDependencyOptions(
            database,
            workload.Id,
            dependency.Selection.ComponentId,
            dependency.Selection.Name,
            cancellation);
        var path = KubernetesResourcePaths.DependencyClaim(
            namespaceName,
            dependency.ClaimId);
        var document = await EnsureOwnedObject(
            kubernetes,
            path,
            "DependencyClaim",
            dependency.ClaimId,
            WorkloadAnnotations(placement.Id, workload.Id),
            BuildDependencyClaim(
                placement,
                workload,
                dependency,
                options.Content,
                namespaceName),
            "dependency_claim",
            cancellation);
        var status = InspectDependencyClaim(
            document,
            dependency.ClaimRevision);
        await UpdateDependencyBinding(
            database,
            workload.Id,
            workload.Revision,
            dependency.Selection.ComponentId,
            dependency.Selection.Name,
            dependency.ClaimRevision,
            status.ObservedRevision,
            status.Phase,
            status.BindingId,
            status.BindingRevision,
            status.Outputs,
            cancellation);
        if (status.Phase != DependencyBindingPhase.Ready)
        {
            return false;
        }

        var current = dependency with
        {
            ObservedClaimRevision = status.ObservedRevision,
            BindingPhase = status.Phase,
            BindingId = status.BindingId,
            BindingRevision = status.BindingRevision,
            Outputs = status.Outputs.Select(item =>
                new Domain.Configuration.ResolvedConfigTarget(
                    item,
                    null,
                    null)).ToArray()
        };
        await ApplyDependencyOutputProjections(
            database,
            configClient,
            configSettings,
            telemetry,
            placement,
            workload,
            current,
            cancellation);
        return true;
    }
}
