using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.V1;
using Grpc.Core;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Requests;

internal static partial class WorkspaceRequests
{
    internal static async ValueTask<WorkspaceLookup> ParseWorkspaceLookup(
        ResolveWorkspaceRequest request,
        CancellationToken cancellation)
    {
        try
        {
            return new WorkspaceLookup(
                await TenantId.Parse(request.TenantId, cancellation),
                await WorkspaceAddress.Parse(
                    request.WorkspaceAddress,
                    cancellation));
        }
        catch (ArgumentException)
        {
            throw new RpcException(
                new Status(
                    StatusCode.InvalidArgument,
                    "Workspace lookup is invalid"));
        }
    }
}
