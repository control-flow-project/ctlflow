using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization.AggregationJson;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses;

internal static partial class AggregationResponses
{
    internal static Task WriteWorkspaceMutationResult(
        HttpResponse response,
        ResourceMutationResult<WorkspaceResource> result,
        int successStatus,
        TenancyJsonContext json,
        CancellationToken cancellation)
    {
        if (result is
            ResourceMutationResult<WorkspaceResource>.Succeeded success)
        {
            return WriteJsonDocument(
                response,
                successStatus,
                CreateWorkspaceDocument(success.Resource),
                json.WorkspaceDocument,
                cancellation);
        }

        throw CreateMutationFailure(result, "workspaces");
    }
}
