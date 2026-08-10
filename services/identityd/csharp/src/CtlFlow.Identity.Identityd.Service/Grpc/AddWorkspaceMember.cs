using System.Diagnostics;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Auditing.AuditDelivery;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityRequests;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;
using IdentityMemberships =
    CtlFlow.Identity.Identityd.Db.Memberships.Memberships;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<WorkspaceMember> AddWorkspaceMember(
        AddWorkspaceMemberRequest request,
        ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.AddWorkspaceMember,
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
            IdentityAdminOperation.AddWorkspaceMember,
            target,
            $"/tenants/{target.TenantId.Value}/workspaces/{target.WorkspaceId!.Value}/members/{accountId.Value}",
            context);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            now,
            context.CancellationToken);
        var result = await IdentityMemberships.AddWorkspaceMember(
            _identityDatabase,
            accountId,
            target.TenantId,
            target.WorkspaceId!,
            audit,
            context.CancellationToken);
        await RecordAdministrationAudit(
            result.AuditIntent,
            context.CancellationToken);
        return CreateWorkspaceMemberMessage(result.Value);
    }
}
