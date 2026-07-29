using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.Execd.Service.Kubernetes;
using static CtlFlow.Execution.Execd.Db.Reconciliation.ReconciliationState;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesApis;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesBodies;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal static partial class ExecutionReconciliation
{
    internal static async Task EnsureWorkloadServices(
        ExecutionDatabase database,
        KubernetesApi kubernetes,
        PlacementRecord placement,
        WorkloadRecord workload,
        string namespaceName,
        string accountName,
        bool ready,
        CancellationToken cancellation)
    {
        var edgeIndex = 0;
        foreach (var item in workload.Interfaces)
        {
            var serviceName = NativeNames.InterfaceService(
                workload.Id,
                item.InterfaceId);
            await EnsureOwnedObject(
                kubernetes,
                KubernetesResourcePaths.Service(
                    namespaceName,
                    serviceName),
                "Service",
                serviceName,
                WorkloadAnnotations(placement.Id, workload.Id),
                BuildInterfaceService(
                    placement.Id,
                    workload,
                    item,
                    namespaceName,
                    serviceName,
                    accountName,
                    edgeIndex),
                "interface_service",
                cancellation);
            await UpdateInterfaceEndpoint(
                database,
                workload.Id,
                workload.Revision,
                item.InterfaceId,
                EndpointHost.Parse(
                    $"{serviceName}.{namespaceName}.svc.cluster.local"),
                ready,
                cancellation);
            if (item.ExposureId is not null)
            {
                edgeIndex++;
            }
        }
    }
}
