using Crossfire.AdapterSqlite.Entities;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class StatisticsCommands
{
    private static long Add(long first, long second)
    {
        var value = checked(first + second);
        return value is >= 0 and <= 9007199254740991 ? value : throw new OverflowException("Statistics counter overflow");
    }

    public static Result<Unit> Record(CrossfireDbContext context, string agentId, string runId, StatisticsBatch batch, long now)
        => Transactions.Run(context, () =>
        {
            var digest = Statistics.Digest(batch); var checkpoint = context.ListenerStatCheckpoint.SingleOrDefault(row => row.RunId == runId);
            if (checkpoint is not null && batch.Sequence <= checkpoint.Sequence) return batch.Sequence == checkpoint.Sequence && digest == checkpoint.Digest ? Results.Done()
                : Results.Fail<Unit>("conflict", "Statistics sequence is stale or has different content");
            var bucket = now / 3600000 * 3600000;
            var interval = context.ListenerStatInterval.SingleOrDefault(row => row.RunId == runId && row.BucketAt == bucket);
            if (interval is not null && interval.AgentId != agentId) return Results.Fail<Unit>("conflict", "Statistics belong to another agent");
            if (interval is null)
            {
                interval = new() { RunId = runId, BucketAt = bucket, AgentId = agentId, StartedAt = batch.StartedAt, EndedAt = batch.EndedAt, CapturedAt = now };
                context.ListenerStatInterval.Add(interval); context.SaveChanges();
            }
            var flows = context.ListenerStatFlow.Where(row => row.RunId == runId && row.BucketAt == bucket).ToArray().ToDictionary(row => (row.RoomId, row.SenderMatrixId, row.MessageType));
            foreach (var flow in batch.Flows)
            {
                if (!flows.TryGetValue((flow.RoomId, flow.SenderMatrixId, flow.MessageType), out var stored))
                {
                    stored = new() { RunId = runId, BucketAt = bucket, RoomId = flow.RoomId, SenderMatrixId = flow.SenderMatrixId, MessageType = flow.MessageType }; context.ListenerStatFlow.Add(stored);
                }
                stored.Observed = Add(stored.Observed, flow.Totals.Observed); stored.Delivered = Add(stored.Delivered, flow.Totals.Delivered);
                stored.ContentBytes = Add(stored.ContentBytes, flow.Totals.ContentBytes); stored.DeliveredBytes = Add(stored.DeliveredBytes, flow.Totals.DeliveredBytes);
                stored.AttachmentBytes = Add(stored.AttachmentBytes, flow.Totals.AttachmentBytes); stored.LargestBytes = Math.Max(stored.LargestBytes, flow.Totals.LargestBytes);
            }
            var runtimes = batch.Usage.Select(sample => sample.Runtime).Distinct().ToArray(); var sessions = batch.Usage.Select(sample => sample.SessionId).Distinct().ToArray();
            var previous = context.RuntimeUsageCheckpoint.Where(row => row.AgentId == agentId && runtimes.Contains(row.Runtime) && sessions.Contains(row.SessionId)).ToArray().ToDictionary(row => (row.Runtime, row.SessionId));
            var usage = context.ListenerStatUsage.Where(row => row.RunId == runId && row.BucketAt == bucket).ToArray().ToDictionary(row => (row.Runtime, row.SessionId));
            var dropped = batch.Dropped;
            foreach (var sample in batch.Usage)
            {
                previous.TryGetValue((sample.Runtime, sample.SessionId), out var last);
                var difference = Statistics.Delta(sample.Tokens, last is null ? null : new(last.Input, last.CachedInput, last.CacheWriteInput, last.Output, last.ReasoningOutput, last.Total));
                if (difference is null) { dropped = Add(dropped, 1); continue; }
                if (!usage.TryGetValue((sample.Runtime, sample.SessionId), out var current))
                {
                    current = new() { RunId = runId, BucketAt = bucket, Runtime = sample.Runtime, SessionId = sample.SessionId, CacheWriteInput = difference.CacheWriteInput, ReasoningOutput = difference.ReasoningOutput };
                    context.ListenerStatUsage.Add(current);
                }
                else
                {
                    current.CacheWriteInput = current.CacheWriteInput is null || difference.CacheWriteInput is null ? null : Add(current.CacheWriteInput.Value, difference.CacheWriteInput.Value);
                    current.ReasoningOutput = current.ReasoningOutput is null || difference.ReasoningOutput is null ? null : Add(current.ReasoningOutput.Value, difference.ReasoningOutput.Value);
                }
                current.Input = Add(current.Input, difference.Input); current.CachedInput = Add(current.CachedInput, difference.CachedInput);
                current.Output = Add(current.Output, difference.Output); current.Total = Add(current.Total, difference.Total);
                if (last is null) { last = new() { AgentId = agentId, Runtime = sample.Runtime, SessionId = sample.SessionId }; context.RuntimeUsageCheckpoint.Add(last); }
                last.Input = sample.Tokens.Input; last.CachedInput = sample.Tokens.CachedInput; last.CacheWriteInput = sample.Tokens.CacheWriteInput;
                last.Output = sample.Tokens.Output; last.ReasoningOutput = sample.Tokens.ReasoningOutput; last.Total = sample.Tokens.Total; last.CapturedAt = now;
            }
            interval.StartedAt = Math.Min(interval.StartedAt, batch.StartedAt); interval.EndedAt = Math.Max(interval.EndedAt, batch.EndedAt); interval.CapturedAt = now; interval.Dropped = Add(interval.Dropped, dropped);
            if (checkpoint is null) { checkpoint = new() { RunId = runId }; context.ListenerStatCheckpoint.Add(checkpoint); }
            checkpoint.Sequence = batch.Sequence; checkpoint.Digest = digest; checkpoint.CapturedAt = now;
            context.SaveChanges(); return Results.Done();
        });
}
