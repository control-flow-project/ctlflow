using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class ListenerCommands
{
    public static Result<Unit> Save(CrossfireDbContext context, ListenerRun value, bool create)
    {
        var id = value.Id;
        var row = create ? new Entities.ListenerRunRow { Id = id, AgentId = value.AgentId, StartedAt = value.StartedAt }
            : context.ListenerRun.Single(row => row.Id == id);
        if (create) context.ListenerRun.Add(row);
        row.Release = value.Release; row.ControllerFleetId = value.Controller.FleetId; row.ControllerConnectionId = value.Controller.ConnectionId;
        row.ControllerCredentialId = value.Controller.CredentialId; row.LastSeenAt = value.LastSeenAt; row.ActiveMs = value.ActiveMs;
        row.MessagesDelivered = value.MessagesDelivered; row.StoppedAt = value.StoppedAt; row.DisconnectRequestedAt = value.DisconnectRequestedAt;
        context.SaveChanges(); return Results.Done();
    }

    public static ListenerPorts Ports(CrossfireDbContext context, Func<long> now)
        => new(FleetCommands.Ports(context, now), id => ListenerQueries.Find(context, id), (value, create) => Save(context, value, create),
            (id, since) => ListenerQueries.Recent(context, id, since), id => ListenerQueries.Totals(context, id),
            (id, page, size) => ListenerQueries.History(context, id, page, size),
            (id, fleet, credential) => ListenerQueries.Facts(context, id, fleet, credential));
}
