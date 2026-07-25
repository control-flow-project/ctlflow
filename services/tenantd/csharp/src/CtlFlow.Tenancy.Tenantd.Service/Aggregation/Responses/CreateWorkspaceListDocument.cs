using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses;

internal static partial class AggregationResponses
{
    internal static WorkspaceListDocument CreateWorkspaceListDocument(
        ResourcePage<WorkspaceResource> page) =>
        new()
        {
            ApiVersion = "tenancy.ctlflow.com/v1alpha1",
            Kind = "WorkspaceList",
            Metadata = new ListMetaDocument
            {
                ResourceVersion = page.ResourceVersion.Value.ToString(
                    System.Globalization.CultureInfo.InvariantCulture),
                Continue = page.NextPageToken?.Value
            },
            Items = page.Items.Select(CreateWorkspaceDocument).ToArray()
        };
}
