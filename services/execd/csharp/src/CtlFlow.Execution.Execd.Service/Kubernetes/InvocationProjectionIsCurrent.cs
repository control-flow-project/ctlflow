using System.Globalization;
using System.Text.Json;
using CtlFlow.Execution.Execd.Domain.Runs;
using static CtlFlow.Execution.Execd.Service.Kubernetes.ExecutionOwnership;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesJson;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static async Task<bool> InvocationProjectionIsCurrent(
        KubernetesApi api,
        RunRecord run,
        string namespaceName,
        string secretName,
        DateTimeOffset now,
        CancellationToken cancellation)
    {
        var current = await GetObject(
            api,
            KubernetesResourcePaths.Secret(
                namespaceName,
                secretName),
            "get_run_invocation",
            cancellation);
        if (current.Document is null)
        {
            return false;
        }

        VerifyOwnedObject(
            current.Document.Value,
            "Secret",
            secretName,
            RunAnnotations(
                run.PlacementId,
                run.WorkloadId,
                run.Id));
        var metadata = ReadRequiredObject(
            current.Document.Value,
            "metadata");
        var annotations = ReadRequiredObject(
            metadata,
            "annotations");
        if (!annotations.TryGetProperty(
                "execution.ctlflow.io/credential-expires-at",
                out var expires)
            || expires.ValueKind != JsonValueKind.String
            || !DateTimeOffset.TryParse(
                expires.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal
                    | DateTimeStyles.AdjustToUniversal,
                out var expiresAt))
        {
            return false;
        }

        return expiresAt > now.AddSeconds(10);
    }
}
