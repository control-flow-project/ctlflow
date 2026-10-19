using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record GrantView(string AgentId, long Revision, bool OwnerConversation, RoomGrant? Grant, RoomGrantApplication? Application, IReadOnlyList<string> Permissions, IReadOnlyList<string> AllowedActions);
public sealed record GrantReadRelations(IReadOnlyList<RoomGrantApplication> Applications, IReadOnlyList<RoomPermission> Permissions);
public sealed record GrantReadPorts(RoomGrantPorts Grants, Func<string, int, int, IReadOnlyList<string>?, Result<Page<RoomGrant>>> Page,
    Func<string, IReadOnlyList<string>, Result<GrantReadRelations>> Relations);

public static class RoomGrantReads
{
    public static Result<Page<GrantView>> List(GrantReadPorts ports, Actor actor, string agentId, int page, int size, IReadOnlyList<string>? filter)
    {
        var target = Authorization.Agent(ports.Grants.Authorization, actor, agentId, "read"); if (!target.IsSuccess) return Result<Page<GrantView>>.Fail(target.Error);
        var grants = ports.Page(agentId, page, size, filter); if (!grants.IsSuccess) return Result<Page<GrantView>>.Fail(grants.Error);
        var relations = ports.Relations(agentId, grants.Value.Items.Select(value => value.RoomId).ToArray()); if (!relations.IsSuccess) return Result<Page<GrantView>>.Fail(relations.Error);
        var canManage = Authorization.Agent(ports.Grants.Authorization, actor, agentId, "room-grant.manage").IsSuccess;
        var conversation = ports.Grants.OwnerConversationRoom(agentId); if (!conversation.IsSuccess) return Result<Page<GrantView>>.Fail(conversation.Error);
        var applied = relations.Value.Applications.ToDictionary(value => value.RoomId, StringComparer.Ordinal); var permissions = relations.Value.Permissions.ToLookup(value => value.RoomId, value => value.PermissionCode, StringComparer.Ordinal);
        return Result<Page<GrantView>>.Success(new(grants.Value.Items.Select(grant => new GrantView(agentId, target.Value.Principal.Revision, conversation.Value == grant.RoomId,
            grant, applied.GetValueOrDefault(grant.RoomId), permissions[grant.RoomId].ToArray(), canManage && conversation.Value != grant.RoomId ? ["set", "remove", "permissions.set"] : [])).ToArray(), page, size, grants.Value.TotalItems));
    }

    public static async ValueTask<Result<GrantView>> Read(RoomGrantPorts ports, Actor actor, string agentId, string roomId, CancellationToken cancellation = default)
    {
        var current = Authorization.ActiveActor(ports.Authorization, actor); if (!current.IsSuccess) return Result<GrantView>.Fail(current.Error);
        var target = ports.Authorization.AgentView(agentId); if (!target.IsSuccess) return Result<GrantView>.Fail(target.Error);
        if (target.Value is null) return Results.Fail<GrantView>("missing", "Agent not found");
        var canRead = Authorization.Agent(ports.Authorization, actor, agentId, "read").IsSuccess; var delegated = false;
        if (!canRead && actor.Kind == "agent")
        {
            var inviter = ports.Find(actor.PrincipalId, roomId); if (!inviter.IsSuccess) return Result<GrantView>.Fail(inviter.Error);
            var permission = ports.Permissions(actor.PrincipalId, roomId); if (!permission.IsSuccess) return Result<GrantView>.Fail(permission.Error);
            if (inviter.Value is { AccessMode: not "none" } && permission.Value.Any(value => value.PermissionCode == "room.agent.invite" && value.Generation == inviter.Value.Generation))
            {
                var native = await ports.Room(current.Value.BackendUserId, roomId, cancellation); if (!native.IsSuccess) return Result<GrantView>.Fail(native.Error);
                delegated = native.Value.CanInvite; canRead = delegated;
            }
        }
        if (!canRead) return Results.Fail<GrantView>("missing", "Room grant not found");
        var grant = ports.Find(agentId, roomId); if (!grant.IsSuccess) return Result<GrantView>.Fail(grant.Error);
        var application = ports.Application(agentId, roomId); if (!application.IsSuccess) return Result<GrantView>.Fail(application.Error);
        var permissions = ports.Permissions(agentId, roomId); if (!permissions.IsSuccess) return Result<GrantView>.Fail(permissions.Error);
        var conversation = ports.OwnerConversationRoom(agentId); if (!conversation.IsSuccess) return Result<GrantView>.Fail(conversation.Error);
        var manage = Authorization.Agent(ports.Authorization, actor, agentId, "room-grant.manage").IsSuccess;
        string[] actions = conversation.Value == roomId ? [] : manage ? ["set", "remove", "permissions.set"] : !delegated ? []
            : grant.Value is null || grant.Value.AccessMode == "none" ? ["set"] : grant.Value.AddedById == actor.PrincipalId ? ["set", "remove"] : [];
        return Result<GrantView>.Success(new(agentId, target.Value.Principal.Revision, conversation.Value == roomId, grant.Value, application.Value, permissions.Value.Select(value => value.PermissionCode).ToArray(), actions));
    }
}
