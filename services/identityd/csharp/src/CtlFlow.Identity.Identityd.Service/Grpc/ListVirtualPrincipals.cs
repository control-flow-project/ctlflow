using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityRequests;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;
using IdentityPrincipals =
    CtlFlow.Identity.Identityd.Db.Principals.Principals;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<ListVirtualPrincipalsResponse>
        ListVirtualPrincipals(
            ListVirtualPrincipalsRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.ListVirtualPrincipals,
            now);
        var target = await ParseIdentityTarget(
            request.TenantId,
            request.HasWorkspaceId ? request.WorkspaceId : null,
            context.CancellationToken);
        var pageSize = await PageSize.Parse(
            request.PageSize,
            context.CancellationToken);
        var after = request.HasAfterPrincipalId
            ? await VirtualPrincipalId.Parse(
                request.AfterPrincipalId,
                context.CancellationToken)
            : null;
        var root = target.WorkspaceId is null
            ? $"/tenants/{target.TenantId.Value}"
            : $"/tenants/{target.TenantId.Value}/workspaces/{target.WorkspaceId.Value}";
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.ListVirtualPrincipals,
            target,
            $"{root}/virtual-principals",
            context);
        var page = await IdentityPrincipals.ListVirtualPrincipals(
            _identityDatabase,
            target,
            pageSize,
            after,
            context.CancellationToken);
        var response = new ListVirtualPrincipalsResponse();
        response.Principals.AddRange(
            page.Items.Select(CreateVirtualPrincipalMessage));
        if (page.NextAfter is not null)
        {
            response.NextAfterPrincipalId = page.NextAfter;
        }

        return response;
    }
}
