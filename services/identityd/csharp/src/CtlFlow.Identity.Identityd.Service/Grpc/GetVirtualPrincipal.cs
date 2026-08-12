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
    public override async Task<CtlFlow.Identity.V1.VirtualPrincipal>
        GetVirtualPrincipal(
            GetVirtualPrincipalRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.GetVirtualPrincipal,
            now);
        var target = await ParseIdentityTarget(
            request.TenantId,
            request.HasWorkspaceId ? request.WorkspaceId : null,
            context.CancellationToken);
        var principalId = await VirtualPrincipalId.Parse(
            request.PrincipalId,
            context.CancellationToken);
        var root = target.WorkspaceId is null
            ? $"/tenants/{target.TenantId.Value}"
            : $"/tenants/{target.TenantId.Value}/workspaces/{target.WorkspaceId.Value}";
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.GetVirtualPrincipal,
            target,
            $"{root}/virtual-principals/{principalId.Value}",
            context);
        var principal = await IdentityPrincipals.GetVirtualPrincipal(
            _identityDatabase,
            principalId,
            target,
            context.CancellationToken);
        return CreateVirtualPrincipalMessage(principal);
    }
}
