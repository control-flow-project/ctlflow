using System.Buffers;
using System.Text.Json;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses.AggregationResponses;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization;

internal static partial class AggregationJson
{
    internal static async Task WriteWorkspaceWatchEvent(
        HttpResponse response,
        ResourceWatchEvent<WorkspaceResource> item,
        TenancyJsonContext json,
        CancellationToken cancellation)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("type", MapWatchEventKind(item.Kind));
            writer.WritePropertyName("object");
            JsonSerializer.Serialize(
                writer,
                CreateWorkspaceDocument(item.Resource),
                json.WorkspaceDocument);
            writer.WriteEndObject();
        }

        await response.Body.WriteAsync(buffer.WrittenMemory, cancellation);
        await response.Body.WriteAsync("\n"u8.ToArray(), cancellation);
        await response.Body.FlushAsync(cancellation);
    }
}
