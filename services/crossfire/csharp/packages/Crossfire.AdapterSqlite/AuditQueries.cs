using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class AuditQueries
{
    public static Result<Page<AuditEvent>> Page(CrossfireDbContext context, string? ownerId, int page, int size)
    {
        var offset = checked((page - 1) * size);
        var count = Stored.Read(() => context.AuditEvent.AsNoTracking().LongCount(row => ownerId == null || row.OwnerId == ownerId)); if (!count.IsSuccess) return Result<Page<AuditEvent>>.Fail(count.Error);
        return Stored.Read(() => context.AuditEvent.AsNoTracking().Where(row => ownerId == null || row.OwnerId == ownerId)
            .OrderByDescending(row => row.CreatedAt).ThenByDescending(row => row.Id).Skip(offset).Take(size).ToArray())
            .Map(values => new Page<AuditEvent>(values.Select(row => new AuditEvent(row.Id, new(row.RequestId, row.ActorKind, row.ActorPrincipalId, row.OwnerId,
                row.TargetKind, row.TargetId, row.Action, row.Outcome, row.Message, row.ActorCredentialId, row.RoomId, row.MembershipGeneration, row.AuthorizerId, row.AddedById, row.PermissionCode), row.CreatedAt)).ToArray(), page, size, count.Value));
    }

    public static AuditReadPorts Ports(CrossfireDbContext context, Func<long> now)
        => new(DiscoveryQueries.Ports(context, now), (owner, page, size) => Page(context, owner, page, size));
}
