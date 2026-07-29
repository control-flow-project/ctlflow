using System.Net;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static async Task DeleteOwnedObject(
        KubernetesApi api,
        string path,
        string kind,
        string name,
        IReadOnlyDictionary<string, string> annotations,
        string operation,
        CancellationToken cancellation)
    {
        var current = await GetObject(
            api,
            path,
            $"get_{operation}",
            cancellation);
        if (current.Document is null)
        {
            return;
        }

        VerifyOwnedObject(
            current.Document.Value,
            kind,
            name,
            annotations);
        var preconditions = BuildDeletePreconditionsBody(
            current.Document.Value);
        try
        {
            using var response = await SendKubernetesRequest(
                api,
                HttpMethod.Delete,
                path,
                preconditions,
                "application/json",
                $"delete_{operation}",
                cancellation);
            if (response.StatusCode == HttpStatusCode.Conflict)
            {
                throw new KubernetesOwnershipCollisionException();
            }

            if (response.StatusCode is not (
                    HttpStatusCode.OK
                    or HttpStatusCode.Accepted
                    or HttpStatusCode.NotFound))
            {
                throw new KubernetesUnavailableException(
                    new InvalidOperationException(
                        "Kubernetes delete failed"));
            }
        }
        finally
        {
            Array.Clear(preconditions);
        }
    }
}
