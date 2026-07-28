using System.Net;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using static CtlFlow.Configuration.Configd.Service.Kubernetes.KubernetesJson;
using static CtlFlow.Configuration.Configd.Service.Kubernetes.KubernetesNames;

namespace CtlFlow.Configuration.Configd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    private const string PlacementNamespaceDomain =
        "ctlflow.execution.v1.PlacementNamespace";
    private const string WorkloadServiceAccountDomain =
        "ctlflow.execution.v1.WorkloadServiceAccount";

    internal static async Task<VerifiedWorkload> GetProjectionOwners(
        KubernetesApi api,
        ConsumerBinding binding,
        CancellationToken cancellation)
    {
        var placementId = binding.Placement.PlacementId.Value;
        var workloadId = binding.ConsumerId.Value;
        var namespaceName = await DeriveNativeName(
            PlacementNamespaceDomain,
            "plc-",
            placementId,
            cancellation);
        var serviceAccountName = await DeriveNativeName(
            WorkloadServiceAccountDomain,
            "wld-",
            workloadId,
            cancellation);

        using (var response = await SendKubernetesRequest(
                   api,
                   HttpMethod.Get,
                   $"/api/v1/namespaces/{namespaceName}",
                   ReadOnlyMemory<byte>.Empty,
                   null,
                   "get_placement_namespace",
                   cancellation))
        {
            EnsureFound(response);
            using var document = response.ParseJson();
            var metadata = ReadRequiredObject(
                document.RootElement,
                "metadata");
            RequireExactName(metadata, namespaceName);
            RequireAnnotation(
                metadata,
                "execution.ctlflow.io/owner-service",
                "execd");
            RequireAnnotation(
                metadata,
                "execution.ctlflow.io/placement-id",
                placementId);
        }

        using var accountResponse = await SendKubernetesRequest(
            api,
            HttpMethod.Get,
            $"/api/v1/namespaces/{namespaceName}"
            + $"/serviceaccounts/{serviceAccountName}",
            ReadOnlyMemory<byte>.Empty,
            null,
            "get_workload_service_account",
            cancellation);
        EnsureFound(accountResponse);
        using var accountDocument = accountResponse.ParseJson();
        var accountMetadata = ReadRequiredObject(
            accountDocument.RootElement,
            "metadata");
        RequireExactName(accountMetadata, serviceAccountName);
        RequireAnnotation(
            accountMetadata,
            "execution.ctlflow.io/owner-service",
            "execd");
        RequireAnnotation(
            accountMetadata,
            "execution.ctlflow.io/placement-id",
            placementId);
        RequireAnnotation(
            accountMetadata,
            "execution.ctlflow.io/workload-id",
            workloadId);
        return new VerifiedWorkload(
            namespaceName,
            serviceAccountName,
            ReadRequiredString(accountMetadata, "uid", 128));
    }

    private static void EnsureFound(KubernetesResponseLease response)
    {
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            throw new KubernetesResourceNotFoundException();
        }

        if (response.StatusCode != HttpStatusCode.OK)
        {
            throw new KubernetesUnavailableException(
                new InvalidOperationException(
                    "Kubernetes lookup failed"));
        }
    }

    private static void RequireExactName(
        System.Text.Json.JsonElement metadata,
        string expected)
    {
        if (!string.Equals(
                ReadRequiredString(metadata, "name", 253),
                expected,
                StringComparison.Ordinal))
        {
            throw new KubernetesOwnershipCollisionException();
        }
    }
}
