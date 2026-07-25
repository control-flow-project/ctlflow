using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses;

internal static partial class AggregationResponses
{
    internal static TenantListDocument CreateTenantListDocument(
        ResourcePage<TenantResource> page) =>
        new()
        {
            ApiVersion = "tenancy.ctlflow.com/v1alpha1",
            Kind = "TenantList",
            Metadata = new ListMetaDocument
            {
                ResourceVersion = page.ResourceVersion.Value.ToString(
                    System.Globalization.CultureInfo.InvariantCulture),
                Continue = page.NextPageToken?.Value
            },
            Items = page.Items.Select(CreateTenantDocument).ToArray()
        };
}
