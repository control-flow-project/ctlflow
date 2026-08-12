using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityRequests;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;
using IdentityMemberships =
    CtlFlow.Identity.Identityd.Db.Memberships.Memberships;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<ListWorkspaceMembersResponse>
        ListWorkspaceMembers(
            ListWorkspaceMembersRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.ListWorkspaceMembers,
            now);
        var target = await ParseIdentityTarget(
            request.TenantId,
            request.WorkspaceId,
            context.CancellationToken);
        var pageSize = await PageSize.Parse(
            request.PageSize,
            context.CancellationToken);
        var after = request.HasAfterAccountId
            ? await AccountId.Parse(
                request.AfterAccountId,
                context.CancellationToken)
            : null;
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.ListWorkspaceMembers,
            target,
            $"/tenants/{target.TenantId.Value}/workspaces/{target.WorkspaceId!.Value}/members",
            context);
        var page = await IdentityMemberships.ListWorkspaceMembers(
            _identityDatabase,
            target.TenantId,
            target.WorkspaceId!,
            pageSize,
            after,
            context.CancellationToken);
        var response = new ListWorkspaceMembersResponse();
        response.Members.AddRange(
            page.Items.Select(CreateWorkspaceMemberMessage));
        if (page.NextAfter is not null)
        {
            response.NextAfterAccountId = page.NextAfter;
        }

        return response;
    }
}
