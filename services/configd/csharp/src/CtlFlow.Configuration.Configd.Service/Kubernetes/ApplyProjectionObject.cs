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
        var path = $"/api/v1/namespaces/{workload.NamespaceName}"
            + $"/{collection}/{objectName}";
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
            objectName);
        try
        {
            using var applied = await SendKubernetesRequest(
                api,
                HttpMethod.Patch,
                path + "?fieldManager=ctlflow-configd&force=true",
                body,
                "application/apply-patch+yaml",
                "apply_projection",
                cancellation);
            if (applied.StatusCode == HttpStatusCode.Conflict)
            {
                throw new KubernetesOwnershipCollisionException();
            }

            if (applied.StatusCode is not (
                    HttpStatusCode.OK
                    or HttpStatusCode.Created))
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
}
