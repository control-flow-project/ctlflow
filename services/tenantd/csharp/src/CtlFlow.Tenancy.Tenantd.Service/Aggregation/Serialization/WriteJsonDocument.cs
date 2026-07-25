using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization;

internal static partial class AggregationJson
{
    internal static async Task WriteJsonDocument<T>(
        HttpResponse response,
        int statusCode,
        T document,
        JsonTypeInfo<T> type,
        CancellationToken cancellation)
    {
        response.StatusCode = statusCode;
        response.ContentType = "application/json";
        await JsonSerializer.SerializeAsync(
            response.Body,
            document,
            type,
            cancellation);
    }
}
