using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<ResourceEventSequence>
        ParseResourceVersion(
            string? value,
            string field,
            CancellationToken cancellation)
    {
        if (value is null)
        {
            throw new InvalidFieldException(
                field,
                "resourceVersion is required",
                "FieldValueRequired");
        }

        try
        {
            return await ResourceEventSequence.Parse(value, cancellation);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidFieldException(field, exception.Message);
        }
    }
}
