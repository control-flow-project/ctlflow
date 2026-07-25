using System.Globalization;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<AggregationCollectionRequest>
        ParseCollectionRequest(
            HttpRequest request,
            CancellationToken cancellation)
    {
        var watch = ReadOptionalSingle(request, "watch");
        var isWatch = watch switch
        {
            null or "false" => false,
            "true" => true,
            _ => throw new InvalidFieldException(
                "watch",
                "watch must be true or false")
        };

        if (isWatch)
        {
            if (request.Query.ContainsKey("limit")
                || request.Query.ContainsKey("continue"))
            {
                throw new InvalidFieldException(
                    "watch",
                    "Watch cannot contain list pagination parameters");
            }

            var resourceVersion = ReadRequiredSingle(
                request,
                "resourceVersion");
            if (!long.TryParse(
                    resourceVersion,
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out var cursor))
            {
                throw new InvalidFieldException(
                    "resourceVersion",
                    "resourceVersion must be a non-negative signed 64-bit integer");
            }

            return new AggregationCollectionRequest.Watch(
                ResourceEventCursor.Parse(cursor));
        }

        if (request.Query.ContainsKey("resourceVersion"))
        {
            throw new InvalidFieldException(
                "resourceVersion",
                "resourceVersion is admitted only for a watch");
        }

        var limitValue = ReadOptionalSingle(request, "limit");
        int? limit = null;
        if (limitValue is not null)
        {
            if (!int.TryParse(
                    limitValue,
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out var parsed))
            {
                throw new InvalidFieldException(
                    "limit",
                    "limit must be an integer");
            }

            limit = parsed;
        }

        var pageSize = await PageSize.Parse(limit, cancellation);
        var pageToken = await PageToken.ParseOptional(
            ReadOptionalSingle(request, "continue"),
            cancellation);
        return new AggregationCollectionRequest.List(pageSize, pageToken);
    }

    private static string? ReadOptionalSingle(
        HttpRequest request,
        string name)
    {
        var values = request.Query[name];
        return values.Count switch
        {
            0 => null,
            1 => values[0],
            _ => throw new InvalidFieldException(
                name,
                $"{name} may appear only once")
        };
    }

    private static string ReadRequiredSingle(
        HttpRequest request,
        string name) =>
        ReadOptionalSingle(request, name)
        ?? throw new InvalidFieldException(
            name,
            $"{name} is required",
            "FieldValueRequired");
}
