using System.Net;
using System.Text.Json;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesJson;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static async Task<JsonElement?> ScaleOwnedDeploymentToZero(
        KubernetesApi api,
        string path,
        string name,
        IReadOnlyDictionary<string, string> annotations,
        CancellationToken cancellation)
    {
        var current = await GetObject(
            api,
            path,
            "get_workload_deployment",
            cancellation);
        if (current.Document is null)
        {
            return null;
        }

        VerifyOwnedObject(
            current.Document.Value,
            "Deployment",
            name,
            annotations);
        var body = BuildScaleBody(
            ReadObjectResourceVersion(current.Document.Value));
        try
        {
            using var response = await SendKubernetesRequest(
                api,
                HttpMethod.Patch,
                path,
                body,
                "application/merge-patch+json",
                "scale_workload_deployment",
                cancellation);
            if (response.StatusCode == HttpStatusCode.Conflict)
            {
                throw new KubernetesOwnershipCollisionException();
            }

            if (response.StatusCode != HttpStatusCode.OK)
            {
                throw new KubernetesUnavailableException(
                    new InvalidOperationException(
                        "Kubernetes Deployment scale failed"));
            }

            using var document = response.ParseJson();
            VerifyOwnedObject(
                document.RootElement,
                "Deployment",
                name,
                annotations);
            return document.RootElement.Clone();
        }
        finally
        {
            Array.Clear(body);
        }
    }

    private static byte[] BuildScaleBody(string resourceVersion) =>
        KubernetesBodies.BuildJsonBody(writer =>
        {
            writer.WriteStartObject();
            writer.WriteStartObject("metadata");
            writer.WriteString("resourceVersion", resourceVersion);
            writer.WriteEndObject();
            writer.WriteStartObject("spec");
            writer.WriteNumber("replicas", 0);
            writer.WriteEndObject();
            writer.WriteEndObject();
        });
}
