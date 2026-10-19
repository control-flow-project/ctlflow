using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public sealed record LogCursor(long At, string Id);
public sealed record LoggingScan(LogCursor? Run = null, LogCursor? Operation = null, long PreviousCutoff = -9007199254740991);
public sealed record LoggingBatch(long Removed, bool More, LoggingScan Scan);
public sealed record LogScanResult(long Removed, bool More, LogCursor? Cursor);

public static class LoggingRetention
{
    public static Result<LoggingBatch> Prune(CrossfireDbContext context, long cutoff, int limit, LoggingScan scan)
    {
        if (cutoff is < -9007199254740991 or > 9007199254740991 || limit is < 1 or > 1000) return Results.Fail<LoggingBatch>("invalid", "Logging cleanup requires an exact cutoff and a 1..1000 record batch");
        return Transactions.Run(context, () =>
        {
            var counts = Statistics(context, cutoff, limit).Concat(Workflows(context, cutoff, limit)).Concat(Runtime(context, cutoff, limit)).ToArray();
            var runs = Runs(context, cutoff, limit, cutoff < scan.PreviousCutoff ? null : scan.Run);
            var operations = Operations(context, cutoff, limit, cutoff < scan.PreviousCutoff ? null : scan.Operation);
            return Result<LoggingBatch>.Success(new(counts.Sum() + runs.Removed + operations.Removed, runs.More || operations.More || counts.Any(value => value == limit), new(runs.Cursor, operations.Cursor, cutoff)));
        });
    }

    private static long[] Statistics(CrossfireDbContext context, long cutoff, int limit)
    {
        var intervals = context.ListenerStatInterval.AsNoTracking().Where(row => row.CapturedAt < cutoff).OrderBy(row => row.CapturedAt).Take(limit).Select(row => new { row.RunId, row.BucketAt }).ToArray();
        foreach (var interval in intervals)
        { var runId = interval.RunId; var bucket = interval.BucketAt; context.ListenerStatInterval.Where(row => row.RunId == runId && row.BucketAt == bucket).ExecuteDelete(); }
        var checkpoints = context.ListenerStatCheckpoint.AsNoTracking().Where(row => row.CapturedAt < cutoff).OrderBy(row => row.CapturedAt).Take(limit).Select(row => row.RunId).ToArray();
        context.ListenerStatCheckpoint.Where(row => checkpoints.Contains(row.RunId)).ExecuteDelete();
        var usage = context.RuntimeUsageCheckpoint.AsNoTracking().Where(row => row.CapturedAt < cutoff).OrderBy(row => row.CapturedAt).Take(limit).Select(row => new { row.AgentId, row.Runtime, row.SessionId }).ToArray();
        foreach (var sample in usage)
        { var agentId = sample.AgentId; var runtime = sample.Runtime; var session = sample.SessionId; context.RuntimeUsageCheckpoint.Where(row => row.AgentId == agentId && row.Runtime == runtime && row.SessionId == session).ExecuteDelete(); }
        return [intervals.Length, checkpoints.Length, usage.Length];
    }

    private static long[] Workflows(CrossfireDbContext context, long cutoff, int limit)
    {
        var audit = context.AuditEvent.AsNoTracking().Where(row => row.CreatedAt < cutoff).OrderBy(row => row.CreatedAt).ThenBy(row => row.Id).Take(limit).Select(row => row.Id).ToArray();
        context.AuditEvent.Where(row => audit.Contains(row.Id)).ExecuteDelete();
        var notices = context.WakeNotice.AsNoTracking().Where(row => row.Status != "pending" && (row.SentAt ?? row.ReservedAt) < cutoff).OrderBy(row => row.ReservedAt).Take(limit).Select(row => new { row.ReceiverAgentId, row.RoomId, row.EventId }).ToArray();
        foreach (var notice in notices)
        { var agent = notice.ReceiverAgentId; var roomId = notice.RoomId; var eventId = notice.EventId; context.WakeNotice.Where(row => row.ReceiverAgentId == agent && row.RoomId == roomId && row.EventId == eventId).ExecuteDelete(); }
        var wakes = context.WakeDelivery.AsNoTracking().Where(row => row.Status != "pending" && (row.DeliveredAt ?? row.CreatedAt) < cutoff).OrderBy(row => row.CreatedAt).ThenBy(row => row.Id).Take(limit).Select(row => row.Id).ToArray();
        context.WakeDelivery.Where(row => wakes.Contains(row.Id)).ExecuteDelete();
        var messages = context.FleetMessage.AsNoTracking().Where(row => row.ExpiresAt < cutoff).OrderBy(row => row.ExpiresAt).ThenBy(row => row.Id).Take(limit).Select(row => row.Id).ToArray();
        context.FleetMessage.Where(row => messages.Contains(row.Id)).ExecuteDelete();
        var invitations = context.MemberInvitation.AsNoTracking().Where(row => row.ExpiresAt < cutoff && (row.ConsumedByMemberId != null || row.ClaimBackendUserId == null)).OrderBy(row => row.ExpiresAt).ThenBy(row => row.Id).Take(limit).Select(row => row.Id).ToArray();
        context.MemberInvitation.Where(row => invitations.Contains(row.Id)).ExecuteDelete();
        var rejected = context.EnrollmentRequest.AsNoTracking().Where(row => (row.Status == "rejected" || row.Status == "expired") && (row.DecidedAt ?? row.ExpiresAt) < cutoff
            && !context.AgentName.Any(name => name.RequestId == row.Id)).OrderBy(row => row.CreatedAt).Take(limit).Select(row => row.Id).ToArray();
        context.EnrollmentItemPermission.Where(row => rejected.Contains(row.RequestId)).ExecuteDelete();
        context.EnrollmentItemWakeSender.Where(row => rejected.Contains(row.RequestId)).ExecuteDelete();
        context.EnrollmentItemPolicy.Where(row => rejected.Contains(row.RequestId)).ExecuteDelete();
        context.EnrollmentControllerMetadata.Where(row => rejected.Contains(row.EnrollmentId)).ExecuteDelete();
        context.EnrollmentItem.Where(row => rejected.Contains(row.RequestId)).ExecuteDelete();
        context.EnrollmentRequest.Where(row => rejected.Contains(row.Id)).ExecuteDelete();
        return [audit.Length, notices.Length, wakes.Length, messages.Length, invitations.Length, rejected.Length];
    }

    private static long[] Runtime(CrossfireDbContext context, long cutoff, int limit)
    {
        var decisions = context.RuntimeDecision.AsNoTracking().Where(row => row.Status != "pending" && row.Status != "answered" && row.CreatedAt < cutoff).OrderBy(row => row.CreatedAt).ThenBy(row => row.Id).Take(limit).Select(row => row.Id).ToArray();
        context.RuntimeDecisionAnswer.Where(row => decisions.Contains(row.DecisionId)).ExecuteDelete();
        context.RuntimeDecisionOption.Where(row => decisions.Contains(row.DecisionId)).ExecuteDelete();
        context.RuntimeDecisionQuestion.Where(row => decisions.Contains(row.DecisionId)).ExecuteDelete();
        context.RuntimeDecision.Where(row => decisions.Contains(row.Id)).ExecuteDelete();
        var incidents = context.RuntimeIncident.AsNoTracking().Where(row => row.RecoveredAt != null && row.RecoveredAt < cutoff
            && !context.IncidentNotification.Any(notice => notice.IncidentId == row.Id && notice.EventId == null)).OrderBy(row => row.RecoveredAt).ThenBy(row => row.Id).Take(limit).Select(row => row.Id).ToArray();
        context.IncidentNotification.Where(row => incidents.Contains(row.IncidentId)).ExecuteDelete();
        context.RuntimeIncident.Where(row => incidents.Contains(row.Id)).ExecuteDelete();
        var stops = context.FleetNativeStop.AsNoTracking().Where(row => row.NativeStoppedAt < cutoff && context.FleetNativeStop.Any(later => later.AgentId == row.AgentId && later.Sequence > row.Sequence))
            .OrderBy(row => row.NativeStoppedAt).ThenBy(row => row.ReceiptId).Take(limit).Select(row => new { row.AgentId, row.ReceiptId }).ToArray();
        foreach (var stop in stops) { var agent = stop.AgentId; var receipt = stop.ReceiptId; context.FleetNativeStop.Where(row => row.AgentId == agent && row.ReceiptId == receipt).ExecuteDelete(); }
        return [decisions.Length, incidents.Length, stops.Length];
    }

    private static LogScanResult Runs(CrossfireDbContext context, long cutoff, int limit, LogCursor? cursor)
    {
        var after = cursor?.At ?? -9007199254740991; var afterId = cursor?.Id ?? "";
        var selected = context.ListenerRun.AsNoTracking().Where(row => row.LastSeenAt < cutoff && (row.LastSeenAt > after || row.LastSeenAt == after && string.Compare(row.Id, afterId) > 0))
            .OrderBy(row => row.LastSeenAt).ThenBy(row => row.Id).Take(limit).Select(row => new { row.Id, row.LastSeenAt }).ToArray();
        var ids = selected.Select(value => value.Id).ToArray();
        var removable = context.ListenerRun.AsNoTracking().Where(row => ids.Contains(row.Id)
            && context.ListenerRun.Any(later => later.AgentId == row.AgentId && (later.StartedAt > row.StartedAt || later.StartedAt == row.StartedAt && string.Compare(later.Id, row.Id) > 0))
            && !context.RuntimeDecision.Any(pin => pin.RunId == row.Id) && !context.WakeDelivery.Any(pin => pin.RunId == row.Id) && !context.FleetNativeStop.Any(pin => pin.RunId == row.Id)
            && !context.RuntimeIncident.Any(pin => pin.RunId == row.Id) && !context.ListenerStatInterval.Any(pin => pin.RunId == row.Id) && !context.ListenerStatCheckpoint.Any(pin => pin.RunId == row.Id)).Select(row => row.Id).ToArray();
        context.RuntimeSetting.Where(row => removable.Contains(row.RunId)).ExecuteDelete();
        context.RuntimeObservation.Where(row => removable.Contains(row.RunId)).ExecuteDelete();
        context.ListenerRun.Where(row => removable.Contains(row.Id)).ExecuteDelete();
        var last = selected.LastOrDefault();
        return new(removable.Length, selected.Length == limit, selected.Length == limit && last is not null ? new(last.LastSeenAt, last.Id) : null);
    }

    private static LogScanResult Operations(CrossfireDbContext context, long cutoff, int limit, LogCursor? cursor)
    {
        var after = cursor?.At ?? -9007199254740991; var afterId = cursor?.Id ?? "";
        var selected = context.FleetRuntimeOperation.AsNoTracking().Where(row => (row.Status == "succeeded" || row.Status == "failed") && row.CompletedAt != null && row.CompletedAt < cutoff
            && (row.CompletedAt > after || row.CompletedAt == after && string.Compare(row.Id, afterId) > 0)).OrderBy(row => row.CompletedAt).ThenBy(row => row.Id).Take(limit).Select(row => new { row.Id, row.CompletedAt }).ToArray();
        var ids = selected.Select(value => value.Id).ToArray();
        var removable = context.FleetRuntimeOperation.AsNoTracking().Where(row => ids.Contains(row.Id) && !(row.Action == "stop" && row.Status == "succeeded"
            && !context.FleetRuntimeOperation.Any(later => later.FleetId == row.FleetId && later.AgentId == row.AgentId && later.Action == "stop" && later.Status == "succeeded"
                && (later.CompletedAt > row.CompletedAt || later.CompletedAt == row.CompletedAt && string.Compare(later.Id, row.Id) > 0)))).Select(row => row.Id).ToArray();
        context.FleetRuntimeOperation.Where(row => removable.Contains(row.Id)).ExecuteDelete();
        var last = selected.LastOrDefault();
        return new(removable.Length, selected.Length == limit, selected.Length == limit && last is not null ? new(last.CompletedAt!.Value, last.Id) : null);
    }
}
