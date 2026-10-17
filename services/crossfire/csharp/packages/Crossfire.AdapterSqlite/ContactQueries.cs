using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class ContactQueries
{
    public static Result<IReadOnlyList<WatchedRun>> Runs(CrossfireDbContext context)
    {
        var ids = Stored.Read(() => context.Agent.AsNoTracking().Select(row => row.PrincipalId).ToArray());
        return !ids.IsSuccess ? Result<IReadOnlyList<WatchedRun>>.Fail(ids.Error)
            : ListenerQueries.Latest(context, ids.Value).Map<IReadOnlyList<WatchedRun>>(runs => runs
                .Select(row => new WatchedRun(row.Id, row.AgentId, row.StartedAt, row.LastSeenAt, row.StoppedAt, row.DisconnectRequestedAt)).ToArray());
    }
    public static Result<IReadOnlyList<WatchedFleet>> Fleets(CrossfireDbContext context)
        => Stored.Read<IReadOnlyList<WatchedFleet>>(() => context.FleetConnection.AsNoTracking().Join(context.Fleet, connection => connection.FleetId, fleet => fleet.Id, (connection, fleet) => new WatchedFleet(fleet.Id, fleet.OwnerId, fleet.Label, connection.ExpiresAt, connection.ClosedAt)).ToArray());
    public static ContactPorts Ports(CrossfireDbContext context, Func<long> now, MatrixPorts matrix, string origin, string serviceId)
        => new(IncidentCommands.Ports(context, now, matrix, origin, serviceId), () => Runs(context), () => Fleets(context));
}
