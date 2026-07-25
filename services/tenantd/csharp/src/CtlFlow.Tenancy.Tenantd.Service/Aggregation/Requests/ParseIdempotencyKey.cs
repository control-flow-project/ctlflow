using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures.AggregationFailures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<IdempotencyKey> ParseIdempotencyKey(
        HttpRequest request,
        CancellationToken cancellation)
    {
        var values = request.Headers["Idempotency-Key"];
        if (values.Count != 1)
        {
            throw CreateAggregationFailure(
                StatusCodes.Status400BadRequest,
                "Invalid",
                "Exactly one Idempotency-Key header is required");
        }

        try
        {
            return await IdempotencyKey.Parse(values[0]!, cancellation);
        }
        catch (ArgumentException)
        {
            throw CreateAggregationFailure(
                StatusCodes.Status400BadRequest,
                "Invalid",
                "Idempotency-Key is not canonical");
        }
    }
}
