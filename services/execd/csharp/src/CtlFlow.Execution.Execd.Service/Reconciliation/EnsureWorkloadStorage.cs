using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.Execd.Service.Kubernetes;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesApis;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesBodies;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal static partial class ExecutionReconciliation
{
    internal static async Task<bool> EnsureWorkloadStorage(
        KubernetesApi kubernetes,
        PlacementRecord placement,
        WorkloadRecord workload,
        string namespaceName,
        CancellationToken cancellation)
    {
        var allBound = true;
        foreach (var storage in workload.Storage)
        {
            var name = NativeNames.StorageClaim(
                workload.Id,
                storage.StorageId);
            var document = await EnsureOwnedObject(
                kubernetes,
                KubernetesResourcePaths.PersistentVolumeClaim(
                    namespaceName,
                    name),
                "PersistentVolumeClaim",
                name,
                WorkloadAnnotations(placement.Id, workload.Id),
                BuildPersistentVolumeClaim(
                    placement.Id,
                    workload.Id,
                    storage,
                    namespaceName,
                    name),
                "persistent_volume_claim",
                cancellation);
            allBound &= PersistentVolumeClaimIsBound(document);
        }

        return allBound;
    }
}
