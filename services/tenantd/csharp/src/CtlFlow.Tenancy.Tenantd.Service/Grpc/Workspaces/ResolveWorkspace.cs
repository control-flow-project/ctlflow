using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
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
    public override async Task<ResolveWorkspaceResponse> ResolveWorkspace(
        ResolveWorkspaceRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateWorkspaceResolution(context);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        var result = await WorkspaceDatabase.ResolveWorkspace(
            _tenantDatabase,
            tenantId,
            await ResourceAddress.Parse(
                request.Address,
                context.CancellationToken),
            context.CancellationToken);
        if (result is WorkspaceResolutionResult.Found resolved
            && identity.Invocation is { } invocation
            && (invocation.TenantId is { } fencedTenant
                    && fencedTenant != tenantId
                || invocation.WorkspaceId is { } fencedWorkspace
                    && fencedWorkspace != resolved.WorkspaceId))
        {
            result = new WorkspaceResolutionResult.NotFound();
        }

        return result switch
        {
            WorkspaceResolutionResult.Found found =>
                new ResolveWorkspaceResponse
                {
                    WorkspaceId = found.WorkspaceId.Value,
                    State = MapResourceState(found.State),
                    Revision = checked((ulong)found.Revision.Value)
                },
            WorkspaceResolutionResult.NotFound =>
                throw CreateExpectedRpcException(StatusCode.NotFound),
            _ => throw new InvalidOperationException(
                "Workspace resolution result is invalid")
        };
    }
}
