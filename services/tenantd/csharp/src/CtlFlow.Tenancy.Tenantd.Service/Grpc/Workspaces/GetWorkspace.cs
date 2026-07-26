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
    public override async Task<CtlFlow.Tenancy.V1.Workspace> GetWorkspace(
        GetWorkspaceRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateWorkspaceLookup(context);
        var workspaceId = await WorkspaceId.Parse(
            request.WorkspaceId,
            context.CancellationToken);
        var result = await WorkspaceDatabase.GetWorkspace(
            _tenantDatabase,
            workspaceId,
            context.CancellationToken);
        if (result is WorkspaceLookupResult.Found located
            && identity.Invocation is { } invocation
            && (invocation.TenantId is { } fencedTenant
                    && located.Workspace.TenantId != fencedTenant
                || invocation.WorkspaceId is { } fencedWorkspace
                    && workspaceId != fencedWorkspace))
        {
            result = new WorkspaceLookupResult.NotFound();
        }

        return result switch
        {
            WorkspaceLookupResult.Found found =>
                CreateWorkspaceResponse(found.Workspace),
            WorkspaceLookupResult.NotFound =>
                throw CreateExpectedRpcException(StatusCode.NotFound),
            _ => throw new InvalidOperationException(
                "Workspace lookup result is invalid")
        };
    }
}
