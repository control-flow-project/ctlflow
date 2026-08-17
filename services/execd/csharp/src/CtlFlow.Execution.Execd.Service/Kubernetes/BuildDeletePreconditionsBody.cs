using System.Buffers;
using System.Text.Json;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesJson;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static byte[] BuildDeletePreconditionsBody(
        JsonElement document)
    {
        try
        {
            var metadata = ReadRequiredObject(document, "metadata");
            var uid = ReadRequiredString(metadata, "uid", 128);
            var resourceVersion = ReadRequiredString(
                metadata,
                "resourceVersion",
                128);
            var output = new ArrayBufferWriter<byte>(256);
            using var writer = new Utf8JsonWriter(output);
            writer.WriteStartObject();
            writer.WriteString("apiVersion", "v1");
            writer.WriteString("kind", "DeleteOptions");
            writer.WriteString("propagationPolicy", "Foreground");
            writer.WriteStartObject("preconditions");
            writer.WriteString("uid", uid);
            writer.WriteString("resourceVersion", resourceVersion);
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.Flush();
            return output.WrittenSpan.ToArray();
        }
        catch (InvalidDataException)
        {
            throw new KubernetesOwnershipCollisionException();
        }
    }
}
