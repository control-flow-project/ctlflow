using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<TenantId> ParseTenantId(
        string value,
        string field,
        CancellationToken cancellation)
    {
        try
        {
            return await TenantId.Parse(value, cancellation);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidFieldException(field, exception.Message);
        }
    }
}
