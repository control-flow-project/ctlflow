using System.Diagnostics;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Auditing.AuditDelivery;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityRequests;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;
using IdentityPrincipals =
    CtlFlow.Identity.Identityd.Db.Principals.Principals;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<CtlFlow.Identity.V1.VirtualPrincipal>
        CreateVirtualPrincipal(
            CreateVirtualPrincipalRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.CreateVirtualPrincipal,
            now);
        var target = await ParseIdentityTarget(
            request.TenantId,
            request.HasWorkspaceId ? request.WorkspaceId : null,
            context.CancellationToken);
        var principalId = await VirtualPrincipalId.Parse(
            request.PrincipalId,
            context.CancellationToken);
        var accountId = await AccountId.Parse(
            request.SubjectAccountId,
            context.CancellationToken);
        var root = target.WorkspaceId is null
            ? $"/tenants/{target.TenantId.Value}"
            : $"/tenants/{target.TenantId.Value}/workspaces/{target.WorkspaceId.Value}";
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.CreateVirtualPrincipal,
            target,
            $"{root}/virtual-principals/{principalId.Value}",
            context);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            now,
            context.CancellationToken);
        var result = await IdentityPrincipals.CreateVirtualPrincipal(
            _identityDatabase,
            principalId,
            accountId,
            target,
            audit,
            context.CancellationToken);
        await RecordAdministrationAudit(
            result.AuditIntent,
            context.CancellationToken);
        return CreateVirtualPrincipalMessage(result.Value);
    }
}
