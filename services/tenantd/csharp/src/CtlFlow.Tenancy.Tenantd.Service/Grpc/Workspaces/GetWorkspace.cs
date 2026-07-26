using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Authorization.TenantAuthorization;
using CtlFlow.Tenancy.Tenantd.Service.Authorization;
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
        if (result is not WorkspaceLookupResult.Found found)
        {
            throw result is WorkspaceLookupResult.NotFound
                ? CreateExpectedRpcException(StatusCode.NotFound)
                : new InvalidOperationException(
                    "Workspace lookup result is invalid");
        }

        await AuthorizeTenantCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            TenantCapability.ReadWorkspace,
            found.Workspace.TenantId,
            workspaceId,
            context.CancellationToken);
        return CreateWorkspaceResponse(found.Workspace);
    }
}
