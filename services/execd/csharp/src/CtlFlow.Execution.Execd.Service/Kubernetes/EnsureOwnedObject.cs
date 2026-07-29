using System.Net;
using System.Text.Json;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesJson;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static async Task<JsonElement> EnsureOwnedObject(
        KubernetesApi api,
        string path,
        string kind,
        string name,
        IReadOnlyDictionary<string, string> annotations,
        ReadOnlyMemory<byte> applyBody,
        string operation,
        CancellationToken cancellation)
    {
        var current = await GetObject(
            api,
            path,
            $"get_{operation}",
            cancellation);
        if (current.Document is { } existing)
        {
            VerifyOwnedObject(
                existing,
                kind,
                name,
                annotations);
            return await ApplyOwnedObject(
                api,
                path,
                kind,
                name,
                annotations,
                applyBody,
                ReadObjectResourceVersion(existing),
                operation,
                cancellation);
        }

        return await CreateOwnedObject(
            api,
            path,
            kind,
            name,
            annotations,
            applyBody,
            operation,
            cancellation);
    }

    private static async Task<JsonElement> CreateOwnedObject(
        KubernetesApi api,
        string path,
        string kind,
        string name,
        IReadOnlyDictionary<string, string> annotations,
        ReadOnlyMemory<byte> body,
        string operation,
        CancellationToken cancellation)
    {
        var separator = path.LastIndexOf(
            "/",
            StringComparison.Ordinal);
        if (separator <= 0 || separator == path.Length - 1)
        {
            throw new InvalidOperationException(
                "Kubernetes object path is invalid");
        }

        using var created = await SendKubernetesRequest(
            api,
            HttpMethod.Post,
            path[..separator],
            body,
            "application/json",
            $"create_{operation}",
            cancellation);
        if (created.StatusCode == HttpStatusCode.Conflict)
        {
            throw new KubernetesOwnershipCollisionException();
        }

        if (created.StatusCode != HttpStatusCode.Created)
        {
            throw new KubernetesUnavailableException(
                new InvalidOperationException(
                    "Kubernetes create failed"));
        }

        using var document = created.ParseJson();
        VerifyOwnedObject(
            document.RootElement,
            kind,
            name,
            annotations);
        return document.RootElement.Clone();
    }

    private static async Task<JsonElement> ApplyOwnedObject(
        KubernetesApi api,
        string path,
        string kind,
        string name,
        IReadOnlyDictionary<string, string> annotations,
        ReadOnlyMemory<byte> applyBody,
        string resourceVersion,
        string operation,
        CancellationToken cancellation)
    {
        var conditionalBody = BuildConditionalApplyBody(
            applyBody,
            resourceVersion);
        try
        {
            using var applied = await SendKubernetesRequest(
            api,
            HttpMethod.Patch,
            path + "?fieldManager=ctlflow-execd&force=true",
            conditionalBody,
            "application/apply-patch+yaml",
            $"apply_{operation}",
            cancellation);
            if (applied.StatusCode == HttpStatusCode.Conflict)
            {
                throw new KubernetesOwnershipCollisionException();
            }

            if (applied.StatusCode != HttpStatusCode.OK)
            {
                throw new KubernetesUnavailableException(
                    new InvalidOperationException(
                        "Kubernetes apply failed"));
            }

            using var document = applied.ParseJson();
            VerifyOwnedObject(
                document.RootElement,
                kind,
                name,
                annotations);
            return document.RootElement.Clone();
        }
        finally
        {
            Array.Clear(conditionalBody);
        }
    }

    private static void VerifyOwnedObject(
        JsonElement document,
        string kind,
        string name,
        IReadOnlyDictionary<string, string> annotations)
    {
        if (!string.Equals(
                ReadRequiredString(document, "kind", 128),
                kind,
                StringComparison.Ordinal))
        {
            throw new KubernetesOwnershipCollisionException();
        }

        var metadata = ReadRequiredObject(document, "metadata");
        if (!string.Equals(
                ReadRequiredString(metadata, "name", 253),
                name,
                StringComparison.Ordinal))
        {
            throw new KubernetesOwnershipCollisionException();
        }

        foreach (var annotation in annotations)
        {
            RequireAnnotation(
                metadata,
                annotation.Key,
                annotation.Value);
        }
    }

    private static string ReadObjectResourceVersion(
        JsonElement document)
    {
        try
        {
            return ReadRequiredString(
                ReadRequiredObject(document, "metadata"),
                "resourceVersion",
                128);
        }
        catch (InvalidDataException)
        {
            throw new KubernetesOwnershipCollisionException();
        }
    }
}
