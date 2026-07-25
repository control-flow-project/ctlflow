using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures.AggregationFailures;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization.AggregationJson;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses;

internal static partial class AggregationResponses
{
    internal static Task WriteTenantMutationResult(
        HttpResponse response,
        ResourceMutationResult<TenantResource> result,
        int successStatus,
        TenancyJsonContext json,
        CancellationToken cancellation)
    {
        if (result is ResourceMutationResult<TenantResource>.Succeeded success)
        {
            return WriteJsonDocument(
                response,
                successStatus,
                CreateTenantDocument(success.Resource),
                json.TenantDocument,
                cancellation);
        }

        throw CreateMutationFailure(result, "tenants");
    }
}
