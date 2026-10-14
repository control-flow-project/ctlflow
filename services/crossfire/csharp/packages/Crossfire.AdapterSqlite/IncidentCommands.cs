using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class IncidentCommands
{
    public static Result<RuntimeIncident?> Find(CrossfireDbContext context, string id)
        => Stored.Read(() => context.RuntimeIncident.AsNoTracking().Where(row => row.Id == id).Select(row => new RuntimeIncident(row.Id, row.OwnerId,
            row.AgentId, row.FleetId, row.RunId, row.SessionId, row.Kind, row.Message, row.CreatedAt, row.RecoveredAt)).SingleOrDefault());

    public static Result<IReadOnlyList<RuntimeIncident>> Active(CrossfireDbContext context, string? agentId, string? fleetId)
        => Stored.Read<IReadOnlyList<RuntimeIncident>>(() => context.RuntimeIncident.AsNoTracking().Where(row => row.RecoveredAt == null && row.AgentId == agentId && row.FleetId == fleetId).OrderBy(row => row.Id)
            .Select(row => new RuntimeIncident(row.Id, row.OwnerId, row.AgentId, row.FleetId, row.RunId, row.SessionId, row.Kind, row.Message, row.CreatedAt, row.RecoveredAt)).ToArray());

    public static Result<Unit> Insert(CrossfireDbContext context, RuntimeIncident value)
    {
        context.RuntimeIncident.Add(new() { Id = value.Id, OwnerId = value.OwnerId, AgentId = value.AgentId, FleetId = value.FleetId, RunId = value.RunId,
            SessionId = value.SessionId, Kind = value.Kind, Message = value.Message, CreatedAt = value.CreatedAt, RecoveredAt = value.RecoveredAt });
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Recover(CrossfireDbContext context, string id, long now)
    {
        context.RuntimeIncident.Single(row => row.Id == id).RecoveredAt = now;
        context.SaveChanges(); return Results.Done();
    }

    public static Result<IncidentNotification?> Notification(CrossfireDbContext context, string id, string phase)
        => Stored.Read(() => context.IncidentNotification.AsNoTracking().Where(row => row.IncidentId == id && row.Phase == phase)
            .Select(row => new IncidentNotification(row.IncidentId, row.Phase, row.Body, row.NextAttemptAt, row.EventId)).SingleOrDefault());

    public static Result<Unit> SaveNotification(CrossfireDbContext context, IncidentNotification value, bool create)
    {
        var id = value.IncidentId; var phase = value.Phase;
        var row = create ? new Entities.IncidentNotificationRow { IncidentId = id, Phase = phase } : context.IncidentNotification.Single(row => row.IncidentId == id && row.Phase == phase);
        if (create) context.IncidentNotification.Add(row);
        row.Body = value.Body; row.NextAttemptAt = value.NextAttemptAt; row.EventId = value.EventId;
        context.SaveChanges(); return Results.Done();
    }

    public static Result<IReadOnlyList<IncidentNotification>> Due(CrossfireDbContext context, long now)
        => Stored.Read<IReadOnlyList<IncidentNotification>>(() => context.IncidentNotification.AsNoTracking().Where(row => row.EventId == null && row.NextAttemptAt <= now)
            .OrderBy(row => row.NextAttemptAt).ThenBy(row => row.Phase).Take(100)
            .Select(row => new IncidentNotification(row.IncidentId, row.Phase, row.Body, row.NextAttemptAt, row.EventId)).ToArray());

    public static Result<string?> ControllerName(CrossfireDbContext context, string? agentId, string? fleetId)
    {
        if (agentId is null) return Stored.Read(() => context.Fleet.AsNoTracking().Where(row => row.Id == fleetId).Select(row => row.ControllerName).SingleOrDefault());
        return Stored.Read(() => context.FleetInstance.AsNoTracking().Where(row => row.AgentId == agentId)
            .Join(context.Fleet, binding => binding.OwnerId, fleet => fleet.OwnerId, (binding, fleet) => new { binding, fleet })
            .Where(joined => joined.binding.FleetKey == joined.fleet.FleetKey).Select(joined => joined.fleet.ControllerName).SingleOrDefault());
    }

    public static Result<ManagementConversation?> Conversation(CrossfireDbContext context, string ownerId)
        => Stored.Read(() => context.ManagementConversation.AsNoTracking().Where(row => row.OwnerId == ownerId)
            .Select(row => new ManagementConversation(row.OwnerId, row.RoomId, row.CreatedAt)).SingleOrDefault());

    public static Result<Unit> Conversation(CrossfireDbContext context, ManagementConversation value)
    {
        context.ManagementConversation.Add(new() { OwnerId = value.OwnerId, RoomId = value.RoomId, CreatedAt = value.CreatedAt });
        context.SaveChanges(); return Results.Done();
    }

    public static IncidentPorts Ports(CrossfireDbContext context, Func<long> now, MatrixPorts matrix, string publicOrigin, string serviceMatrixId)
        => new(AuthorizationQueries.Ports(context, now), new SqliteUnitOfWork(context), id => Find(context, id), (agent, fleet) => Active(context, agent, fleet),
            value => Insert(context, value), (id, timestamp) => Recover(context, id, timestamp), (id, phase) => Notification(context, id, phase),
            (value, create) => SaveNotification(context, value, create), timestamp => Due(context, timestamp), (agent, fleet) => ControllerName(context, agent, fleet),
            id => Conversation(context, id), value => Conversation(context, value), matrix, publicOrigin, serviceMatrixId);
}
