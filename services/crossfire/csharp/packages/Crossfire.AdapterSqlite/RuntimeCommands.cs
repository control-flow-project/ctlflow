using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class RuntimeCommands
{
    public static Result<Unit> Observation(CrossfireDbContext context, string agentId, RuntimeObservation value)
    {
        var runId = value.RunId; var sessionId = value.SessionId;
        var row = context.RuntimeObservation.SingleOrDefault(row => row.RunId == runId && row.SessionId == sessionId);
        if (row is null)
        {
            row = new() { RunId = runId, SessionId = sessionId, AgentId = agentId };
            context.RuntimeObservation.Add(row);
        }
        row.RoomId = value.RoomId; row.Runtime = value.Runtime; row.State = value.State; row.ObservedAt = value.ObservedAt; row.LastActivityAt = value.LastActivityAt;
        row.HistoryAvailable = value.HistoryAvailable is null ? null : value.HistoryAvailable == true ? 1 : 0;
        row.HistoryMode = value.HistoryMode; row.MaxInputBytes = value.MaxInputBytes; row.ErrorMessage = value.ErrorMessage;
        context.RuntimeSetting.RemoveRange(context.RuntimeSetting.Where(row => row.RunId == runId && row.SessionId == sessionId).ToArray());
        context.SaveChanges();
        foreach (var setting in value.Settings) context.RuntimeSetting.Add(new() { RunId = runId, SessionId = sessionId, Name = setting.Name,
            ConfiguredValue = setting.Configured, EffectiveValue = setting.Effective });
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> InvalidateStop(CrossfireDbContext context, string agentId, long now)
    {
        context.FleetNativeStop.Where(row => row.AgentId == agentId && row.InvalidatedAt == null).ExecuteUpdate(setters => setters.SetProperty(row => row.InvalidatedAt, now));
        return Results.Done();
    }

    public static RuntimePorts Ports(CrossfireDbContext context, Func<long> now, MessagingPorts messaging, string publicOrigin, string serviceBackendUserId)
        => new(AuthorizationQueries.Ports(context, now), new SqliteUnitOfWork(context), (id, run) => ListenerQueries.Live(context, id, run, now()),
            id => RuntimeQueries.Observations(context, id), (id, value) => Observation(context, id, value), (id, timestamp) => InvalidateStop(context, id, timestamp),
            IncidentCommands.Ports(context, now, messaging, publicOrigin, serviceBackendUserId));
}
