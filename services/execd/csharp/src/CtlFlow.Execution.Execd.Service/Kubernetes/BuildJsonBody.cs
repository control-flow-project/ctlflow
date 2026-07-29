using System.Buffers;
using System.Text.Json;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesBodies
{
    internal static byte[] BuildJsonBody(
        Action<Utf8JsonWriter> write)
    {
        var output = new ArrayBufferWriter<byte>(4_096);
        using var writer = new Utf8JsonWriter(output);
        write(writer);
        writer.Flush();
        return output.WrittenSpan.ToArray();
    }
}
