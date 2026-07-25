using System.Buffers;
using System.Text.Json;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses.AggregationResponses;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization;

internal static partial class AggregationJson
{
    internal static async Task WriteTenantWatchEvent(
        HttpResponse response,
        ResourceWatchEvent<TenantResource> item,
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
                CreateTenantDocument(item.Resource),
                json.TenantDocument);
            writer.WriteEndObject();
        }

        await response.Body.WriteAsync(buffer.WrittenMemory, cancellation);
        await response.Body.WriteAsync("\n"u8.ToArray(), cancellation);
        await response.Body.FlushAsync(cancellation);
    }

    private static string MapWatchEventKind(ResourceEventKind kind) =>
        kind switch
        {
            ResourceEventKind.Added => "ADDED",
            ResourceEventKind.Modified => "MODIFIED",
            _ => throw new InvalidOperationException(
                "Resource event kind is invalid")
        };
}
