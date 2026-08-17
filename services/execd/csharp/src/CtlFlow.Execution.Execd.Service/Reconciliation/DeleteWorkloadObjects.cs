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
    internal static async Task<bool> DeleteWorkloadObjects(
        ExecutionDatabase database,
        KubernetesApi kubernetes,
        PlacementRecord placement,
        WorkloadRecord workload,
        string namespaceName,
        CancellationToken cancellation)
    {
        var annotations = WorkloadAnnotations(
            placement.Id,
            workload.Id);
        var accountName = Domain.Naming.NativeNames.ParseServiceAccountSubject(
            workload.ServiceAccountSubject).Name;
        if (workload.Behavior is WorkloadBehavior.Continuous)
        {
            var deploymentPath = KubernetesResourcePaths.Deployment(
                namespaceName,
                accountName);
            var deployment = await GetObject(
                kubernetes,
                deploymentPath,
                "get_workload_deployment",
                cancellation);
            if (deployment.Document is not null)
            {
                await DeleteOwnedObject(
                    kubernetes,
                    deploymentPath,
                    "Deployment",
                    accountName,
                    annotations,
                    "workload_deployment",
                    cancellation);
                return false;
            }
        }

        foreach (var item in workload.Interfaces)
        {
            var serviceName = NativeNames.InterfaceService(
                workload.Id,
                item.InterfaceId);
            await DeleteOwnedObject(
                kubernetes,
                KubernetesResourcePaths.Service(
                    namespaceName,
                    serviceName),
                "Service",
                serviceName,
                annotations,
                "interface_service",
                cancellation);
            await UpdateInterfaceEndpoint(
                database,
                workload.Id,
                workload.Revision,
                item.InterfaceId,
                null,
                false,
                cancellation);
        }

        foreach (var dependency in workload.Dependencies)
        {
            await DeleteOwnedObject(
                kubernetes,
                KubernetesResourcePaths.DependencyClaim(
                    namespaceName,
                    dependency.ClaimId),
                "DependencyClaim",
                dependency.ClaimId,
                annotations,
                "dependency_claim",
                cancellation);
        }

        var trustName = NativeNames.EdgedTrustConfigMap(workload.Id);
        await DeleteOwnedObject(
            kubernetes,
            KubernetesResourcePaths.ConfigMap(
                namespaceName,
                trustName),
            "ConfigMap",
            trustName,
            annotations,
            "edged_trust_config_map",
            cancellation);

        var workloadTrustName =
            NativeNames.WorkloadTrustConfigMap(workload.Id);
        await DeleteOwnedObject(
            kubernetes,
            KubernetesResourcePaths.ConfigMap(
                namespaceName,
                workloadTrustName),
            "ConfigMap",
            workloadTrustName,
            annotations,
            "workload_trust_config_map",
            cancellation);

        await DeleteOwnedObject(
            kubernetes,
            KubernetesResourcePaths.ServiceAccount(
                namespaceName,
                accountName),
            "ServiceAccount",
            accountName,
            annotations,
            "workload_service_account",
            cancellation);
        return true;
    }
}
