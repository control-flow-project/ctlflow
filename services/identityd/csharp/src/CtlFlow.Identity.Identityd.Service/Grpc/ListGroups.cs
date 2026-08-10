using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.Groups;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityRequests;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;
using IdentityGroups = CtlFlow.Identity.Identityd.Db.Groups.Groups;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<ListGroupsResponse> ListGroups(
        ListGroupsRequest request,
        ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.ListGroups,
            now);
        var target = await ParseIdentityTarget(
            request.TenantId,
            request.HasWorkspaceId ? request.WorkspaceId : null,
            context.CancellationToken);
        var pageSize = await PageSize.Parse(
            request.PageSize,
            context.CancellationToken);
        var after = request.HasAfterGroupId
            ? await GroupId.Parse(
                request.AfterGroupId,
                context.CancellationToken)
            : null;
        var path = target.WorkspaceId is null
            ? $"/tenants/{target.TenantId.Value}/groups"
            : $"/tenants/{target.TenantId.Value}/workspaces/{target.WorkspaceId.Value}/groups";
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.ListGroups,
            target,
            path,
            context);
        var page = await IdentityGroups.ListGroups(
            _identityDatabase,
            target,
            pageSize,
            after,
            context.CancellationToken);
        var response = new ListGroupsResponse();
        response.Groups.AddRange(page.Items.Select(CreateGroupMessage));
        if (page.NextAfter is not null)
        {
            response.NextAfterGroupId = page.NextAfter;
        }

        return response;
    }
}
