using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.Groups;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityRequests;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;
using IdentityGroups = CtlFlow.Identity.Identityd.Db.Groups.Groups;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<ListGroupMembersResponse> ListGroupMembers(
        ListGroupMembersRequest request,
        ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.ListGroupMembers,
            now);
        var target = await ParseIdentityTarget(
            request.TenantId,
            request.HasWorkspaceId ? request.WorkspaceId : null,
            context.CancellationToken);
        var groupId = await GroupId.Parse(
            request.GroupId,
            context.CancellationToken);
        var pageSize = await PageSize.Parse(
            request.PageSize,
            context.CancellationToken);
        var after = request.HasAfterPrincipalId
            ? await PrincipalId.Parse(
                request.AfterPrincipalId,
                context.CancellationToken)
            : null;
        var root = target.WorkspaceId is null
            ? $"/tenants/{target.TenantId.Value}"
            : $"/tenants/{target.TenantId.Value}/workspaces/{target.WorkspaceId.Value}";
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.ListGroupMembers,
            target,
            $"{root}/groups/{groupId.Value}/members",
            context);
        var page = await IdentityGroups.ListGroupMembers(
            _identityDatabase,
            groupId,
            target,
            pageSize,
            after,
            context.CancellationToken);
        var response = new ListGroupMembersResponse();
        response.Members.AddRange(
            page.Items.Select(CreateGroupMemberMessage));
        if (page.NextAfter is not null)
        {
            response.NextAfterPrincipalId = page.NextAfter;
        }

        return response;
    }
}
