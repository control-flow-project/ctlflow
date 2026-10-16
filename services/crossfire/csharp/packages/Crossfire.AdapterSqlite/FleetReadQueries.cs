using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class FleetReadQueries
{
    public static Result<Page<FleetRecord>> Page(CrossfireDbContext context, int page, int size, string? ownerId, string term)
    {
        var search = "%" + term + "%"; var offset = checked((page - 1) * size);
        var count = Stored.Read(() => context.Fleet.AsNoTracking().LongCount(row => row.ArchivedAt == null && (ownerId == null || row.OwnerId == ownerId)
            && (EF.Functions.Like(row.Label, search) || EF.Functions.Like(row.FleetKey, search) || EF.Functions.Like(row.ControllerName, search))));
        if (!count.IsSuccess) return Result<Page<FleetRecord>>.Fail(count.Error);
        return Stored.Read(() => context.Fleet.AsNoTracking().Where(row => row.ArchivedAt == null && (ownerId == null || row.OwnerId == ownerId)
            && (EF.Functions.Like(row.Label, search) || EF.Functions.Like(row.FleetKey, search) || EF.Functions.Like(row.ControllerName, search))).OrderByDescending(row => row.CreatedAt).ThenBy(row => row.Id).Skip(offset).Take(size)
            .Select(row => new FleetRecord(row.Id, row.OwnerId, row.FleetKey, row.Label, row.ControllerName, row.Revision, row.CreatedAt, row.UpdatedAt, row.DeliveryEnabled == 1, row.ArchivedAt)).ToArray())
            .Map(values => new Page<FleetRecord>(values, page, size, count.Value));
    }

    public static Result<IReadOnlyList<FleetMetadata>> Metadata(CrossfireDbContext context, IReadOnlyList<string> requested)
    {
        var ids = requested.ToArray();
        return Stored.Read<IReadOnlyList<FleetMetadata>>(() => context.FleetControllerMetadata.AsNoTracking().Where(row => ids.Contains(row.FleetId)).OrderBy(row => row.FleetId).ThenBy(row => row.Key)
            .Select(row => new FleetMetadata(row.FleetId, row.Key, row.Value)).ToArray());
    }

    public static Result<IReadOnlyList<FleetConnection>> Connections(CrossfireDbContext context, IReadOnlyList<string> requested)
    {
        var ids = requested.ToArray();
        return Stored.Read<IReadOnlyList<FleetConnection>>(() => context.FleetConnection.AsNoTracking().Where(row => ids.Contains(row.FleetId))
            .Select(row => new FleetConnection(row.FleetId, row.ConnectionId, row.CredentialId, row.LastSeenAt, row.ExpiresAt, row.ClosedAt)).ToArray());
    }

    public static Result<Unit> ReplaceMetadata(CrossfireDbContext context, string fleetId, IReadOnlyDictionary<string, string> values)
    {
        var rows = context.FleetControllerMetadata.Where(row => row.FleetId == fleetId).ToArray();
        foreach (var row in rows.Where(row => !values.ContainsKey(row.Key))) context.FleetControllerMetadata.Remove(row);
        var saved = EnrollmentFleetCommands.Metadata(context, fleetId, values);
        return saved;
    }

    public static FleetReadPorts Ports(CrossfireDbContext context, Func<long> now)
        => new(FleetCommands.Ports(context, now), DiscoveryQueries.Ports(context, now), AgentReadQueries.Ports(context, now), (page, size, owner, search) => Page(context, page, size, owner, search),
            ids => Metadata(context, ids), ids => Connections(context, ids), (agents, fleets, timestamp) => RetirementQueries.Snapshot(context, agents, fleets, timestamp), (id, values) => ReplaceMetadata(context, id, values));
}
