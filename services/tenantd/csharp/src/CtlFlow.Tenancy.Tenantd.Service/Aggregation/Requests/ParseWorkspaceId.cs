using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<WorkspaceId> ParseWorkspaceId(
        string value,
        string field,
        CancellationToken cancellation)
    {
        try
        {
            return await WorkspaceId.Parse(value, cancellation);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidFieldException(field, exception.Message);
        }
    }
}
