using CtlFlow.Execution.Execd.Db.Providers;
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
    internal static async Task SuspendWorkload(
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

        if (workload.Behavior is not WorkloadBehavior.Continuous
            || !AllProjectionsAreResolved(workload))
        {
            return;
        }

        var accountName = Domain.Naming.NativeNames.ParseServiceAccountSubject(
            workload.ServiceAccountSubject).Name;
        var path = KubernetesResourcePaths.Deployment(
            namespaceName,
            accountName);
        if ((await GetObject(
                kubernetes,
                path,
                "get_workload_deployment",
                cancellation)).Document is null)
        {
            return;
        }

        await EnsureOwnedObject(
            kubernetes,
            path,
            "Deployment",
            accountName,
            WorkloadAnnotations(placement.Id, workload.Id),
            BuildWorkloadDeployment(
                placement,
                workload,
                namespaceName,
                accountName,
                kubernetes.Settings.Edged,
                kubernetes.Settings.Bootstrap,
                0),
            "workload_deployment",
            cancellation);
    }
}
