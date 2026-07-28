using System.Net;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Claims;
using CtlFlow.Configuration.Configd.Service.Security.Workloads;
using static CtlFlow.Configuration.Configd.Service.Kubernetes.KubernetesJson;
using static CtlFlow.Configuration.Configd.Service.Kubernetes.KubernetesNames;

namespace CtlFlow.Configuration.Configd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static async Task ValidateDependencyClaim(
        KubernetesApi api,
        DependencyClaimSelector selector,
        ConsumerBinding binding,
        KubernetesServiceAccountSubject provisioner,
        CancellationToken cancellation)
    {
        var namespaceName = await DeriveNativeName(
            PlacementNamespaceDomain,
            "plc-",
            binding.Placement.PlacementId.Value,
            cancellation);
        using var response = await SendKubernetesRequest(
            api,
            HttpMethod.Get,
            $"/apis/execution.ctlflow.io/v1/namespaces/{namespaceName}"
            + $"/dependencyclaims/{selector.Id.Value}",
            ReadOnlyMemory<byte>.Empty,
            null,
            "get_dependency_claim",
            cancellation);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            throw new KubernetesResourceNotFoundException();
        }

        if (response.StatusCode != HttpStatusCode.OK)
        {
            throw new KubernetesUnavailableException(
                new InvalidOperationException(
                    "Dependency claim lookup failed"));
        }

        using var document = response.ParseJson();
        var metadata = ReadRequiredObject(
            document.RootElement,
            "metadata");
        RequireExactName(metadata, selector.Id.Value);
        RequireAnnotation(
            metadata,
            "execution.ctlflow.io/owner-service",
            "execd");
        var specification = ReadRequiredObject(
            document.RootElement,
            "spec");
        if (ReadRequiredPositiveUInt64(
                specification,
                "claimRevision")
            != checked((ulong)selector.Revision.Value)
            || !string.Equals(
                ReadRequiredString(
                    specification,
                    "placementId",
                    64),
                binding.Placement.PlacementId.Value,
                StringComparison.Ordinal)
            || !string.Equals(
                ReadRequiredString(
                    specification,
                    "workloadId",
                    64),
                binding.ConsumerId.Value,
                StringComparison.Ordinal))
        {
            throw new DependencyClaimConflictException();
        }

        if (!string.Equals(
                ReadRequiredString(
                    specification,
                    "provisionerSubject",
                    253),
                provisioner.Value,
                StringComparison.Ordinal))
        {
            throw new DependencyClaimCallerMismatchException();
        }
    }
}
