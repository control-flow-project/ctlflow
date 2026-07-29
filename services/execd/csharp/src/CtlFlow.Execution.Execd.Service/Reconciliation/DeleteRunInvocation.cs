using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Service.Kubernetes;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesApis;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal static partial class ExecutionReconciliation
{
    internal static async Task DeleteRunInvocation(
        KubernetesApi kubernetes,
        RunRecord run,
        string namespaceName,
        CancellationToken cancellation)
    {
        if (run.Target is PlacementTarget.Global)
        {
            return;
        }

        var name = NativeNames.RunInvocationSecret(run.Id);
        await DeleteOwnedObject(
            kubernetes,
            KubernetesResourcePaths.Secret(namespaceName, name),
            "Secret",
            name,
            RunAnnotations(
                run.PlacementId,
                run.WorkloadId,
                run.Id),
            "run_invocation",
            cancellation);
    }
}
