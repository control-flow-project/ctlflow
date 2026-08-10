using System.Diagnostics;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Auditing.AuditDelivery;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityRequests;
using IdentityMemberships =
    CtlFlow.Identity.Identityd.Db.Memberships.Memberships;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<RemoveWorkspaceMemberResponse>
        RemoveWorkspaceMember(
            RemoveWorkspaceMemberRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.RemoveWorkspaceMember,
            now);
        var target = await ParseIdentityTarget(
            request.TenantId,
            request.WorkspaceId,
            context.CancellationToken);
        var accountId = await AccountId.Parse(
            request.AccountId,
            context.CancellationToken);
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.RemoveWorkspaceMember,
            target,
            $"/tenants/{target.TenantId.Value}/workspaces/{target.WorkspaceId!.Value}/members/{accountId.Value}",
            context);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            now,
            context.CancellationToken);
        var result = await IdentityMemberships.RemoveWorkspaceMember(
            _identityDatabase,
            accountId,
            target.TenantId,
            target.WorkspaceId!,
            audit,
            context.CancellationToken);
        await RecordAdministrationAudit(
            result.AuditIntent,
            context.CancellationToken);
        return new RemoveWorkspaceMemberResponse();
    }
}
