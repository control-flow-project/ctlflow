using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.Execd.Service.Kubernetes;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesApis;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesBodies;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal static partial class ExecutionReconciliation
{
    internal static async Task ReconcileEdgedTrustConfigMap(
        KubernetesApi kubernetes,
        PlacementRecord placement,
        WorkloadRecord workload,
        string namespaceName,
        CancellationToken cancellation)
    {
        var configMapName = NativeNames.EdgedTrustConfigMap(
            workload.Id);
        var path = KubernetesResourcePaths.ConfigMap(
            namespaceName,
            configMapName);
        var annotations = WorkloadAnnotations(
            placement.Id,
            workload.Id);
        if (!workload.Interfaces.Any(
                item => item.ExposureId is not null))
        {
            await DeleteOwnedObject(
                kubernetes,
                path,
                "ConfigMap",
                configMapName,
                annotations,
                "edged_trust_config_map",
                cancellation);
            return;
        }

        await EnsureOwnedObject(
            kubernetes,
            path,
            "ConfigMap",
            configMapName,
            annotations,
            BuildEdgedTrustConfigMap(
                placement.Id,
                workload.Id,
                namespaceName,
                configMapName,
                kubernetes.Settings.Edged
                    .IdentityCertificateAuthority),
            "edged_trust_config_map",
            cancellation);
    }
}
