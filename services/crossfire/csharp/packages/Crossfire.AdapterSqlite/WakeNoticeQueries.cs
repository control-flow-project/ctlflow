using Crossfire.AdapterSqlite.Entities;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class WakeNoticeQueries
{
    private static WakeNotice View(WakeNoticeRow row) => new(row.ReceiverAgentId, row.EventId, row.SenderMatrixId, row.RoomId, row.ReservedAt, row.MessageBody, row.Status, row.SentAt, row.NativeEventId, row.NextAttemptAt, row.LastError);
    public static Result<WakeNotice?> Find(CrossfireDbContext context, string agentId, string eventId)
        => Stored.Read(() => context.WakeNotice.AsNoTracking().SingleOrDefault(row => row.ReceiverAgentId == agentId && row.EventId == eventId)).Map(value => value is null ? null : View(value));
    public static Result<bool> Recent(CrossfireDbContext context, string agentId, string sender, long since)
        => Stored.Read(() => context.WakeNotice.AsNoTracking().Any(row => row.ReceiverAgentId == agentId && row.SenderMatrixId == sender && row.ReservedAt >= since));
    public static Result<IReadOnlyList<WakeNotice>> Due(CrossfireDbContext context, long now)
        => Stored.Read(() => context.WakeNotice.AsNoTracking().Where(row => row.Status == "pending" && (row.NextAttemptAt ?? row.ReservedAt) <= now)
            .OrderBy(row => row.NextAttemptAt ?? row.ReservedAt).ThenBy(row => row.ReceiverAgentId).ThenBy(row => row.EventId).Take(100).ToArray()).Map<IReadOnlyList<WakeNotice>>(values => values.Select(View).ToArray());
    public static Result<Unit> Save(CrossfireDbContext context, WakeNotice value, bool create)
    {
        var agentId = value.ReceiverAgentId; var eventId = value.EventId;
        var row = create ? new WakeNoticeRow { ReceiverAgentId = agentId, EventId = eventId, SenderMatrixId = value.SenderMatrixId, RoomId = value.RoomId, ReservedAt = value.ReservedAt, MessageBody = value.MessageBody }
            : context.WakeNotice.Single(row => row.ReceiverAgentId == agentId && row.EventId == eventId);
        row.Status = value.Status; row.SentAt = value.SentAt; row.NativeEventId = value.NativeEventId; row.NextAttemptAt = value.NextAttemptAt; row.LastError = value.LastError;
        if (create) context.WakeNotice.Add(row); context.SaveChanges(); return Results.Done();
    }
    public static WakeNoticePorts Ports(CrossfireDbContext context, Func<long> now, MatrixPorts matrix)
        => new(AgentRoutingQueries.Ports(context, now, matrix.Room), matrix, (agent, entry) => Find(context, agent, entry), (value, create) => Save(context, value, create),
            (agent, sender, since) => Recent(context, agent, sender, since), at => Due(context, at));
}
