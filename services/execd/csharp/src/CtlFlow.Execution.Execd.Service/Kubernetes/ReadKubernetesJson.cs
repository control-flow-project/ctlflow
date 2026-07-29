using System.Text.Json;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesJson
{
    internal static JsonElement ReadRequiredObject(
        JsonElement parent,
        string property)
    {
        if (!parent.TryGetProperty(property, out var value)
            || value.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException(
                "Kubernetes object shape is invalid");
        }

        return value;
    }

    internal static string ReadRequiredString(
        JsonElement parent,
        string property,
        int maximumLength)
    {
        if (!parent.TryGetProperty(property, out var value)
            || value.ValueKind != JsonValueKind.String
            || value.GetString() is not { Length: > 0 } text
            || text.Length > maximumLength)
        {
            throw new InvalidDataException(
                "Kubernetes string field is invalid");
        }

        return text;
    }

    internal static ulong ReadRequiredPositiveUInt64(
        JsonElement parent,
        string property)
    {
        if (!parent.TryGetProperty(property, out var value)
            || value.ValueKind != JsonValueKind.Number
            || !value.TryGetUInt64(out var number)
            || number == 0)
        {
            throw new InvalidDataException(
                "Kubernetes revision field is invalid");
        }

        return number;
    }

    internal static void RequireAnnotation(
        JsonElement metadata,
        string name,
        string expected)
    {
        var annotations = ReadRequiredObject(metadata, "annotations");
        if (!annotations.TryGetProperty(name, out var value)
            || value.ValueKind != JsonValueKind.String
            || !string.Equals(
                value.GetString(),
                expected,
                StringComparison.Ordinal))
        {
            throw new KubernetesOwnershipCollisionException();
        }
    }
}
