using System.Buffers;
using System.Text.Json;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static byte[] BuildConditionalApplyBody(
        ReadOnlyMemory<byte> body,
        string resourceVersion)
    {
        using var document = JsonDocument.Parse(body);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException(
                "Kubernetes apply body is invalid");
        }

        var output = new ArrayBufferWriter<byte>(body.Length + 128);
        using var writer = new Utf8JsonWriter(output);
        writer.WriteStartObject();
        var hasMetadata = false;
        foreach (var property in document.RootElement.EnumerateObject())
        {
            if (!string.Equals(
                    property.Name,
                    "metadata",
                    StringComparison.Ordinal))
            {
                property.WriteTo(writer);
                continue;
            }

            hasMetadata = true;
            WriteConditionalMetadata(
                writer,
                property.Value,
                resourceVersion);
        }

        if (!hasMetadata)
        {
            throw new InvalidDataException(
                "Kubernetes apply body has no metadata");
        }

        writer.WriteEndObject();
        writer.Flush();
        return output.WrittenSpan.ToArray();
    }

    private static void WriteConditionalMetadata(
        Utf8JsonWriter writer,
        JsonElement metadata,
        string resourceVersion)
    {
        if (metadata.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException(
                "Kubernetes apply metadata is invalid");
        }

        writer.WriteStartObject("metadata");
        foreach (var property in metadata.EnumerateObject())
        {
            if (!string.Equals(
                    property.Name,
                    "resourceVersion",
                    StringComparison.Ordinal))
            {
                property.WriteTo(writer);
            }
        }
        writer.WriteString("resourceVersion", resourceVersion);
        writer.WriteEndObject();
    }
}
