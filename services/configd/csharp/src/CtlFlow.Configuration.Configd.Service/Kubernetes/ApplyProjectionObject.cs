using System.Net;
using CtlFlow.Configuration.Configd.Db.Projections;
using CtlFlow.Configuration.Configd.Domain.Projections;
using static CtlFlow.Configuration.Configd.Service.Kubernetes.KubernetesNames;

namespace CtlFlow.Configuration.Configd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    private const string ProjectionObjectDomain =
        "ctlflow.configuration.v1.ProjectionObject";

    internal static async Task ApplyProjectionObject(
        KubernetesApi api,
        ProjectionMetadata projection,
        ProjectionPayloadLease payload,
        CancellationToken cancellation)
    {
        var workload = await GetProjectionOwners(
            api,
            projection.Binding,
            cancellation);
        var objectName = await DeriveNativeName(
            ProjectionObjectDomain,
            "prj-",
            projection.Id.Value,
            cancellation);
        var collection = projection.Target.Kind
            == ProjectionDataKind.Configuration
            ? "configmaps"
            : "secrets";
        var collectionPath = $"/api/v1/namespaces/{workload.NamespaceName}"
            + $"/{collection}";
        var path = $"{collectionPath}/{objectName}";
        string? resourceVersion = null;
        using (var current = await SendKubernetesRequest(
                   api,
                   HttpMethod.Get,
                   path,
                   ReadOnlyMemory<byte>.Empty,
                   null,
                   "get_projection",
                   cancellation))
        {
            if (current.StatusCode == HttpStatusCode.OK)
            {
                using var document = current.ParseJson();
                if (InspectProjectionObject(
                        document.RootElement,
                        projection,
                        payload,
                        workload,
                        objectName)
                    == ProjectionObjectState.Current)
                {
                    return;
                }
                resourceVersion = ReadProjectionResourceVersion(
                    document.RootElement);
            }
            else if (current.StatusCode != HttpStatusCode.NotFound)
            {
                throw new KubernetesUnavailableException(
                    new InvalidOperationException(
                        "Projection lookup failed"));
            }
        }

        var body = BuildProjectionApplyBody(
            projection,
            payload,
            workload,
            objectName,
            resourceVersion);
        try
        {
            using var applied = await SendKubernetesRequest(
                api,
                resourceVersion is null
                    ? HttpMethod.Post
                    : HttpMethod.Patch,
                resourceVersion is null
                    ? collectionPath
                    : path + "?fieldManager=ctlflow-configd&force=true",
                body,
                resourceVersion is null
                    ? "application/json"
                    : "application/apply-patch+yaml",
                resourceVersion is null
                    ? "create_projection"
                    : "apply_projection",
                cancellation);
            if (applied.StatusCode == HttpStatusCode.Conflict)
            {
                throw new KubernetesOwnershipCollisionException();
            }

            var expectedStatus = resourceVersion is null
                ? HttpStatusCode.Created
                : HttpStatusCode.OK;
            if (applied.StatusCode != expectedStatus)
            {
                throw new KubernetesUnavailableException(
                    new InvalidOperationException(
                        "Projection apply failed"));
            }

            using var document = applied.ParseJson();
            if (InspectProjectionObject(
                    document.RootElement,
                    projection,
                    payload,
                    workload,
                    objectName)
                != ProjectionObjectState.Current)
            {
                throw new KubernetesUnavailableException(
                    new InvalidDataException(
                        "Applied projection did not converge"));
            }
        }
        finally
        {
            Array.Clear(body);
        }
    }

    private static string ReadProjectionResourceVersion(
        System.Text.Json.JsonElement document)
    {
        try
        {
            return KubernetesJson.ReadRequiredString(
                KubernetesJson.ReadRequiredObject(
                    document,
                    "metadata"),
                "resourceVersion",
                128);
        }
        catch (InvalidDataException)
        {
            throw new KubernetesOwnershipCollisionException();
        }
    }
}
