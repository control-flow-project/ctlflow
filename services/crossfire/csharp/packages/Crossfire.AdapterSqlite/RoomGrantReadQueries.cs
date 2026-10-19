using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class RoomGrantReadQueries
{
    public static Result<Page<RoomGrant>> Page(CrossfireDbContext context, string agentId, int page, int size, IReadOnlyList<string>? requested)
    {
        var filter = requested is not null; var ids = requested?.ToArray() ?? []; var offset = checked((page - 1) * size);
        var count = Stored.Read(() => context.AgentRoomGrant.AsNoTracking().LongCount(row => row.AgentId == agentId && (!filter || ids.Contains(row.RoomId))));
        if (!count.IsSuccess) return Result<Page<RoomGrant>>.Fail(count.Error);
        return Stored.Read(() => context.AgentRoomGrant.AsNoTracking().Where(row => row.AgentId == agentId && (!filter || ids.Contains(row.RoomId))).OrderBy(row => row.RoomId).Skip(offset).Take(size)
            .Select(row => new RoomGrant(row.AgentId, row.RoomId, row.Generation, row.AuthorizerId, row.AddedById, row.InvitationEventId, row.AdmissionKind,
                row.AccessMode, BackendData.ParseNullable(row.NativeAccess), row.Muted == 1, row.Revision, row.AccessRevision, row.UpdatedAt)).ToArray()).Map(values => new Page<RoomGrant>(values, page, size, count.Value));
    }

    public static Result<GrantReadRelations> Relations(CrossfireDbContext context, string agentId, IReadOnlyList<string> requested)
    {
        var ids = requested.ToArray();
        var applications = Stored.Read(() => context.RoomGrantApplication.AsNoTracking().Where(row => row.AgentId == agentId && ids.Contains(row.RoomId)).OrderBy(row => row.RoomId)
            .Select(row => new RoomGrantApplication(row.AgentId, row.RoomId, row.ObservedGeneration, row.AppliedRevision, row.AppliedAccessRevision, row.Membership, BackendData.ParseNullable(row.NativeAccess),
                row.LastAttemptAt, row.LastSuccessAt, row.NextCheckAt, row.ErrorCode, row.ErrorMessage)).ToArray());
        if (!applications.IsSuccess) return Result<GrantReadRelations>.Fail(applications.Error);
        return Stored.Read(() => context.AgentRoomPermission.AsNoTracking().Where(row => row.AgentId == agentId && ids.Contains(row.RoomId)).OrderBy(row => row.PermissionCode)
            .Select(row => new RoomPermission(row.AgentId, row.RoomId, row.Generation, row.PermissionCode, row.GrantScope, row.GrantedByMemberId, row.GrantedAt)).ToArray())
            .Map(values => new GrantReadRelations(applications.Value, values));
    }

    public static GrantReadPorts Ports(CrossfireDbContext context, Func<long> now, MessagingPorts messaging)
        => new(RoomGrantCommands.Ports(context, now, messaging), (id, page, size, filter) => Page(context, id, page, size, filter), (id, rooms) => Relations(context, id, rooms));
}
