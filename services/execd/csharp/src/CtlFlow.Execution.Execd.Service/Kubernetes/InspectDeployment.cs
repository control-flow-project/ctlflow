using System.Text.Json;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesJson;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static DeploymentStatus InspectDeployment(
        JsonElement document)
    {
        var metadata = ReadRequiredObject(document, "metadata");
        var generation = ReadOptionalNonnegativeInt64(
            metadata,
            "generation");
        if (!document.TryGetProperty("status", out var status)
            || status.ValueKind is JsonValueKind.Null
                or JsonValueKind.Undefined)
        {
            return new DeploymentStatus(0, 0, 0, generation, 0);
        }

        if (status.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException(
                "Deployment status is invalid");
        }

        var available = ReadOptionalNonnegativeInt64(
            status,
            "availableReplicas");
        var replicas = ReadOptionalNonnegativeInt64(
            status,
            "replicas");
        var updated = ReadOptionalNonnegativeInt64(
            status,
            "updatedReplicas");
        var observed = ReadOptionalNonnegativeInt64(
            status,
            "observedGeneration");
        if (observed > generation)
        {
            throw new InvalidDataException(
                "Deployment status is invalid");
        }

        return new DeploymentStatus(
            checked((int)available),
            checked((int)replicas),
            checked((int)updated),
            generation,
            observed);
    }

    private static long ReadOptionalNonnegativeInt64(
        JsonElement parent,
        string property)
    {
        if (!parent.TryGetProperty(property, out var value))
        {
            return 0;
        }

        if (value.ValueKind != JsonValueKind.Number
            || !value.TryGetInt64(out var number)
            || number < 0)
        {
            throw new InvalidDataException(
                "Kubernetes integer field is invalid");
        }

        return number;
    }
}
