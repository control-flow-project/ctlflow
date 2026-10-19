using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class RoomGrantQueries
{
    public static Result<IReadOnlyList<RoomGrant>> Due(CrossfireDbContext context, long now, int limit)
        => Stored.Read<IReadOnlyList<RoomGrant>>(() => context.RoomGrantApplication.AsNoTracking().Where(row => row.NextCheckAt <= now)
            .Join(context.AgentRoomGrant, application => new { application.AgentId, application.RoomId }, grant => new { grant.AgentId, grant.RoomId }, (application, grant) => new { application, grant })
            .OrderBy(joined => joined.application.NextCheckAt).ThenBy(joined => joined.grant.AgentId).ThenBy(joined => joined.grant.RoomId).Take(limit)
            .Select(joined => new RoomGrant(joined.grant.AgentId, joined.grant.RoomId, joined.grant.Generation, joined.grant.AuthorizerId, joined.grant.AddedById,
                joined.grant.InvitationEventId, joined.grant.AdmissionKind, joined.grant.AccessMode, BackendData.ParseNullable(joined.grant.NativeAccess), joined.grant.Muted == 1,
                joined.grant.Revision, joined.grant.AccessRevision, joined.grant.UpdatedAt)).ToArray());

    public static Result<RoomGrant?> Find(CrossfireDbContext context, string agentId, string roomId)
        => Stored.Read(() => context.AgentRoomGrant.AsNoTracking().Where(row => row.AgentId == agentId && row.RoomId == roomId)
            .Select(row => new RoomGrant(row.AgentId, row.RoomId, row.Generation, row.AuthorizerId, row.AddedById, row.InvitationEventId,
                row.AdmissionKind, row.AccessMode, BackendData.ParseNullable(row.NativeAccess), row.Muted == 1, row.Revision, row.AccessRevision, row.UpdatedAt)).SingleOrDefault());

    public static Result<IReadOnlyList<RoomGrant>> Grants(CrossfireDbContext context, string agentId)
        => Stored.Read<IReadOnlyList<RoomGrant>>(() => context.AgentRoomGrant.AsNoTracking().Where(row => row.AgentId == agentId).OrderBy(row => row.RoomId)
            .Select(row => new RoomGrant(row.AgentId, row.RoomId, row.Generation, row.AuthorizerId, row.AddedById, row.InvitationEventId,
                row.AdmissionKind, row.AccessMode, BackendData.ParseNullable(row.NativeAccess), row.Muted == 1, row.Revision, row.AccessRevision, row.UpdatedAt)).ToArray());

    public static Result<IReadOnlyList<RoomPermission>> Permissions(CrossfireDbContext context, string agentId, string roomId)
        => Stored.Read<IReadOnlyList<RoomPermission>>(() => context.AgentRoomPermission.AsNoTracking().Where(row => row.AgentId == agentId && row.RoomId == roomId)
            .OrderBy(row => row.PermissionCode).Select(row => new RoomPermission(row.AgentId, row.RoomId, row.Generation, row.PermissionCode,
                row.GrantScope, row.GrantedByMemberId, row.GrantedAt)).ToArray());

    public static Result<RoomGrantApplication?> Application(CrossfireDbContext context, string agentId, string roomId)
        => Stored.Read(() => context.RoomGrantApplication.AsNoTracking().Where(row => row.AgentId == agentId && row.RoomId == roomId)
            .Select(row => new RoomGrantApplication(row.AgentId, row.RoomId, row.ObservedGeneration, row.AppliedRevision, row.AppliedAccessRevision,
                row.Membership, BackendData.ParseNullable(row.NativeAccess), row.LastAttemptAt, row.LastSuccessAt, row.NextCheckAt, row.ErrorCode, row.ErrorMessage)).SingleOrDefault());

    public static Result<PrivateConversation?> Private(CrossfireDbContext context, string roomId)
    {
        var agent = Stored.Read(() => context.AgentOwnerConversation.AsNoTracking().Where(row => row.RoomId == roomId)
            .Select(row => new PrivateConversation("agent", row.AgentId, row.OwnerId)).SingleOrDefault());
        if (!agent.IsSuccess || agent.Value is not null) return agent;
        return Stored.Read(() => context.ManagementConversation.AsNoTracking().Where(row => row.RoomId == roomId)
            .Select(row => new PrivateConversation("management", null, row.OwnerId)).SingleOrDefault());
    }

    public static Result<string?> OwnerRoom(CrossfireDbContext context, string agentId)
        => Stored.Read(() => context.AgentOwnerConversation.AsNoTracking().Where(row => row.AgentId == agentId).Select(row => row.RoomId).SingleOrDefault());

    public static Result<RoomPolicy?> FleetPolicy(CrossfireDbContext context, string agentId)
    {
        var policy = Stored.Read(() => context.FleetInstancePolicy.AsNoTracking().Where(row => row.AgentId == agentId).Select(row => row.ApprovedByMemberId).SingleOrDefault());
        if (!policy.IsSuccess) return Result<RoomPolicy?>.Fail(policy.Error);
        if (policy.Value is null) return Result<RoomPolicy?>.Success(null);
        return Stored.Read(() => context.FleetInstancePermission.AsNoTracking().Where(row => row.AgentId == agentId)
            .OrderBy(row => row.PermissionCode).Select(row => row.PermissionCode).ToArray()).Map(values => (RoomPolicy?)new RoomPolicy(policy.Value, values));
    }
}
