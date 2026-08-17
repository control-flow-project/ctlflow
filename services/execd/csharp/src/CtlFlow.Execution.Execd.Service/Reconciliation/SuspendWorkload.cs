using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.Execd.Service.Kubernetes;
using static CtlFlow.Execution.Execd.Db.Reconciliation.ReconciliationState;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesApis;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal static partial class ExecutionReconciliation
{
    internal static async Task<bool> SuspendWorkload(
        ExecutionDatabase database,
        KubernetesApi kubernetes,
        PlacementRecord placement,
        WorkloadRecord workload,
        string namespaceName,
        CancellationToken cancellation)
    {
        foreach (var item in workload.Interfaces)
        {
            await UpdateInterfaceEndpoint(
                database,
                workload.Id,
                workload.Revision,
                item.InterfaceId,
                item.Host,
                false,
                cancellation);
        }

        if (workload.Behavior is not WorkloadBehavior.Continuous)
        {
            return true;
        }

        var accountName = Domain.Naming.NativeNames.ParseServiceAccountSubject(
            workload.ServiceAccountSubject).Name;
        var path = KubernetesResourcePaths.Deployment(
            namespaceName,
            accountName);
        var deployment = await ScaleOwnedDeploymentToZero(
                kubernetes,
                path,
                accountName,
                WorkloadAnnotations(placement.Id, workload.Id),
                cancellation);
        if (deployment is null)
        {
            return true;
        }

        var status = InspectDeployment(deployment.Value);
        return status.ObservedGeneration >= status.Generation
            && status.AvailableReplicas == 0
            && status.Replicas == 0
            && status.UpdatedReplicas == 0;
    }
}
