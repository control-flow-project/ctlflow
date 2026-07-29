using System.Text.Json;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static bool PersistentVolumeClaimIsBound(
        JsonElement document)
    {
        if (!document.TryGetProperty("status", out var status)
            || status.ValueKind is JsonValueKind.Null
                or JsonValueKind.Undefined)
        {
            return false;
        }

        if (status.ValueKind != JsonValueKind.Object
            || !status.TryGetProperty("phase", out var phase)
            || phase.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException(
                "PersistentVolumeClaim status is invalid");
        }

        return string.Equals(
            phase.GetString(),
            "Bound",
            StringComparison.Ordinal);
    }
}
