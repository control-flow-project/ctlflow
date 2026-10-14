using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class ContactQueries
{
    public static Result<IReadOnlyList<WatchedRun>> Runs(CrossfireDbContext context)
        => Stored.Read<IReadOnlyList<WatchedRun>>(() => context.ListenerRun.AsNoTracking().Where(row => !context.ListenerRun.Any(later => later.AgentId == row.AgentId && (later.StartedAt > row.StartedAt || later.StartedAt == row.StartedAt && string.Compare(later.Id, row.Id) > 0)))
            .Select(row => new WatchedRun(row.Id, row.AgentId, row.StartedAt, row.LastSeenAt, row.StoppedAt, row.DisconnectRequestedAt)).ToArray());
    public static Result<IReadOnlyList<WatchedFleet>> Fleets(CrossfireDbContext context)
        => Stored.Read<IReadOnlyList<WatchedFleet>>(() => context.FleetConnection.AsNoTracking().Join(context.Fleet, connection => connection.FleetId, fleet => fleet.Id, (connection, fleet) => new WatchedFleet(fleet.Id, fleet.OwnerId, fleet.Label, connection.ExpiresAt, connection.ClosedAt)).ToArray());
    public static ContactPorts Ports(CrossfireDbContext context, Func<long> now, MatrixPorts matrix, string origin, string serviceId)
        => new(IncidentCommands.Ports(context, now, matrix, origin, serviceId), () => Runs(context), () => Fleets(context));
}
