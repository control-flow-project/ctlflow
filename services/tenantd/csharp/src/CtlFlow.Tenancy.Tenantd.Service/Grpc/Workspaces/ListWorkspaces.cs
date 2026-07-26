using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses.TenancyResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.TenantGrpcErrors;
using WorkspaceDatabase =
    CtlFlow.Tenancy.Tenantd.Db.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<ListWorkspacesResponse> ListWorkspaces(
        ListWorkspacesRequest request,
        ServerCallContext context)
    {
        await AuthenticateAdministration(context);
        var after = request.HasAfterWorkspaceId
            ? await WorkspaceId.Parse(
                request.AfterWorkspaceId,
                context.CancellationToken)
            : null;
        var result = await WorkspaceDatabase.ListWorkspaces(
            _tenantDatabase,
            await TenantId.Parse(
                request.TenantId,
                context.CancellationToken),
            await PageSize.Parse(
                request.PageSize,
                context.CancellationToken),
            after,
            context.CancellationToken);
        if (result is WorkspaceListResult.TenantNotFound)
        {
            throw CreateExpectedRpcException(StatusCode.NotFound);
        }

        if (result is not WorkspaceListResult.Found found)
        {
            throw new InvalidOperationException(
                "Workspace list result is invalid");
        }

        var response = new ListWorkspacesResponse();
        response.Workspaces.Add(
            found.Page.Workspaces.Select(CreateWorkspaceResponse));
        if (found.Page.NextAfterWorkspaceId is not null)
        {
            response.NextAfterWorkspaceId =
                found.Page.NextAfterWorkspaceId.Value;
        }

        return response;
    }
}
