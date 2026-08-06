using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.Execd.Service.Kubernetes;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesApis;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesBodies;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal static partial class ExecutionReconciliation
{
    // Every realized Workload receives the product runtime trust bundle; it is
    // not gated on exposures, modes, or Placement level.
    internal static async Task ReconcileWorkloadTrustConfigMap(
        KubernetesApi kubernetes,
        PlacementRecord placement,
        WorkloadRecord workload,
        string namespaceName,
        CancellationToken cancellation)
    {
        var configMapName = NativeNames.WorkloadTrustConfigMap(
            workload.Id);
        await EnsureOwnedObject(
            kubernetes,
            KubernetesResourcePaths.ConfigMap(
                namespaceName,
                configMapName),
            "ConfigMap",
            configMapName,
            WorkloadAnnotations(placement.Id, workload.Id),
            BuildWorkloadTrustConfigMap(
                placement.Id,
                workload.Id,
                namespaceName,
                configMapName,
                kubernetes.Settings.Bootstrap),
            "workload_trust_config_map",
            cancellation);
    }
}
