using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.Execd.Service.Identity;
using CtlFlow.Execution.Execd.Service.Kubernetes;
using CtlFlow.Execution.Execd.Service.Telemetry;
using CtlFlow.Identity.V1;
using static CtlFlow.Execution.Execd.Service.Identity.RunInvocations;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesApis;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesBodies;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal static partial class ExecutionReconciliation
{
    internal static async Task<string?> EnsureRunInvocation(
        KubernetesApi kubernetes,
        IdentityService.IdentityServiceClient identityClient,
        IdentitySettings identitySettings,
        ExecdTelemetry telemetry,
        RunRecord run,
        string namespaceName,
        DateTimeOffset now,
        CancellationToken cancellation)
    {
        if (run.Target is PlacementTarget.Global)
        {
            return null;
        }

        var secretName = NativeNames.RunInvocationSecret(run.Id);
        if (await InvocationProjectionIsCurrent(
                kubernetes,
                run,
                namespaceName,
                secretName,
                now,
                cancellation))
        {
            return secretName;
        }

        var credential = await IssueRunInvocation(
            identityClient,
            identitySettings,
            telemetry,
            run,
            now,
            cancellation);
        var body = BuildInvocationSecret(
            run,
            credential,
            namespaceName,
            secretName);
        try
        {
            await EnsureOwnedObject(
                kubernetes,
                KubernetesResourcePaths.Secret(
                    namespaceName,
                    secretName),
                "Secret",
                secretName,
                RunAnnotations(
                    run.PlacementId,
                    run.WorkloadId,
                    run.Id),
                body,
                "run_invocation",
                cancellation);
        }
        finally
        {
            Array.Clear(body);
        }
        return secretName;
    }
}
