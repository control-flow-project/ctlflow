using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using Microsoft.Net.Http.Headers;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures.AggregationFailures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization;

internal static partial class AggregationJson
{
    internal static async ValueTask<T> ReadJsonDocument<T>(
        HttpRequest request,
        JsonTypeInfo<T> type,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!MediaTypeHeaderValue.TryParse(
                request.ContentType,
                out var contentType)
            || !string.Equals(
                contentType.MediaType.Value,
                "application/json",
                StringComparison.OrdinalIgnoreCase))
        {
            throw CreateAggregationFailure(
                StatusCodes.Status415UnsupportedMediaType,
                "Invalid",
                "Content-Type must be application/json");
        }

        if (request.ContentLength
            is > TenancyAggregationApi.MaximumRequestBodyBytes)
        {
            throw CreateAggregationFailure(
                StatusCodes.Status413PayloadTooLarge,
                "Invalid",
                "Request body exceeds the admitted size");
        }

        var document = await JsonSerializer.DeserializeAsync(
            request.Body,
            type,
            cancellation);
        return document ?? throw new JsonException(
            "A JSON request document is required");
    }
}
