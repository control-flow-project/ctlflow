using System.Net;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static async Task<KubernetesObject> GetObject(
        KubernetesApi api,
        string path,
        string operation,
        CancellationToken cancellation)
    {
        using var response = await SendKubernetesRequest(
            api,
            HttpMethod.Get,
            path,
            ReadOnlyMemory<byte>.Empty,
            null,
            operation,
            cancellation);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return new KubernetesObject(
                HttpStatusCode.NotFound,
                null);
        }

        if (response.StatusCode != HttpStatusCode.OK)
        {
            throw new KubernetesUnavailableException(
                new InvalidOperationException(
                    "Kubernetes lookup failed"));
        }

        using var document = response.ParseJson();
        return new KubernetesObject(
            response.StatusCode,
            document.RootElement.Clone());
    }
}
