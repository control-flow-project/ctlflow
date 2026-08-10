using System.Diagnostics;
using CtlFlow.Identity.Identityd.Domain.Groups;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Auditing.AuditDelivery;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityRequests;
using IdentityGroups = CtlFlow.Identity.Identityd.Db.Groups.Groups;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<DeleteGroupResponse> DeleteGroup(
        DeleteGroupRequest request,
        ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.DeleteGroup,
            now);
        var target = await ParseIdentityTarget(
            request.TenantId,
            request.HasWorkspaceId ? request.WorkspaceId : null,
            context.CancellationToken);
        var groupId = await GroupId.Parse(
            request.GroupId,
            context.CancellationToken);
        var path = target.WorkspaceId is null
            ? $"/tenants/{target.TenantId.Value}/groups/{groupId.Value}"
            : $"/tenants/{target.TenantId.Value}/workspaces/{target.WorkspaceId.Value}/groups/{groupId.Value}";
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.DeleteGroup,
            target,
            path,
            context);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            now,
            context.CancellationToken);
        var result = await IdentityGroups.DeleteGroup(
            _identityDatabase,
            groupId,
            target,
            audit,
            context.CancellationToken);
        await RecordAdministrationAudit(
            result.AuditIntent,
            context.CancellationToken);
        return new DeleteGroupResponse();
    }
}
