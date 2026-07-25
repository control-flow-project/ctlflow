using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    private const string TenantSelectorPrefix = "spec.tenantId=";

    internal static async ValueTask<TenantId> ParseWorkspaceTenantSelector(
        HttpRequest request,
        CancellationToken cancellation)
    {
        var values = request.Query["fieldSelector"];
        if (values.Count != 1
            || values[0] is not { } selector
            || !selector.StartsWith(
                TenantSelectorPrefix,
                StringComparison.Ordinal))
        {
            throw new InvalidFieldException(
                "fieldSelector",
                "fieldSelector must contain exactly spec.tenantId=ID",
                "FieldValueRequired");
        }

        var tenantId = selector[TenantSelectorPrefix.Length..];
        try
        {
            return await TenantId.Parse(tenantId, cancellation);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidFieldException(
                "fieldSelector",
                exception.Message);
        }
    }
}
