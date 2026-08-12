using System.Diagnostics;
using CtlFlow.Identity.Identityd.Domain.Groups;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Auditing.AuditDelivery;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityRequests;
using IdentityGroups = CtlFlow.Identity.Identityd.Db.Groups.Groups;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<RemoveGroupMemberResponse> RemoveGroupMember(
        RemoveGroupMemberRequest request,
        ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.RemoveGroupMember,
            now);
        var target = await ParseIdentityTarget(
            request.TenantId,
            request.HasWorkspaceId ? request.WorkspaceId : null,
            context.CancellationToken);
        var groupId = await GroupId.Parse(
            request.GroupId,
            context.CancellationToken);
        var principalId = await PrincipalId.Parse(
            request.PrincipalId,
            context.CancellationToken);
        var root = target.WorkspaceId is null
            ? $"/tenants/{target.TenantId.Value}"
            : $"/tenants/{target.TenantId.Value}/workspaces/{target.WorkspaceId.Value}";
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.RemoveGroupMember,
            target,
            $"{root}/groups/{groupId.Value}/members/{principalId.Value}",
            context);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            now,
            context.CancellationToken);
        var result = await IdentityGroups.RemoveGroupMember(
            _identityDatabase,
            groupId,
            principalId,
            target,
            audit,
            context.CancellationToken);
        await RecordAdministrationAudit(
            result.AuditIntent,
            context.CancellationToken);
        return new RemoveGroupMemberResponse();
    }
}
