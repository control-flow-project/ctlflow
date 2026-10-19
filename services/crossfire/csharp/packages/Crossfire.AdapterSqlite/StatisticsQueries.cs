using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public sealed record StatisticsInterval(string AgentId, long Count, long Dropped, long First, long Last);
public sealed record UsageAggregate(string AgentId, long Input, long Cached, long Writes, long UnknownWrites, long Output, long Reasoning, long UnknownReasoning, long Total);

public static class StatisticsQueries
{
    public static Result<StatisticsSummary> Read(CrossfireDbContext context, IReadOnlyList<string> selected, long since, int page, int pageSize)
        => Stored.Read(() =>
        {
            var agentIds = selected.ToArray(); var offset = checked((page - 1) * pageSize);
            var intervals = context.ListenerStatInterval.AsNoTracking().Where(row => agentIds.Contains(row.AgentId) && row.CapturedAt >= since).GroupBy(row => row.AgentId)
                .Select(group => new StatisticsInterval(group.Key, group.LongCount(), group.Sum(row => row.Dropped), group.Min(row => row.CapturedAt), group.Max(row => row.CapturedAt))).ToArray();
            var flows = context.ListenerStatFlow.AsNoTracking().Join(context.ListenerStatInterval,
                    flow => new { flow.RunId, flow.BucketAt }, interval => new { interval.RunId, interval.BucketAt }, (flow, interval) => new { flow, interval })
                .Where(joined => agentIds.Contains(joined.interval.AgentId) && joined.interval.CapturedAt >= since)
                .GroupBy(joined => new { joined.interval.AgentId, joined.flow.RoomId, joined.flow.SenderBackendUserId, joined.flow.MessageType })
                .OrderByDescending(group => group.Sum(joined => joined.flow.Observed)).ThenBy(group => group.Key.SenderBackendUserId).ThenBy(group => group.Key.AgentId).ThenBy(group => group.Key.RoomId).ThenBy(group => group.Key.MessageType)
                .Select(group => new StatisticsFlow(group.Key.AgentId, group.Key.RoomId, group.Key.SenderBackendUserId, group.Key.MessageType,
                    new TrafficTotals(group.Sum(joined => joined.flow.Observed), group.Sum(joined => joined.flow.Delivered), group.Sum(joined => joined.flow.ContentBytes),
                        group.Sum(joined => joined.flow.DeliveredBytes), group.Sum(joined => joined.flow.AttachmentBytes), group.Max(joined => joined.flow.LargestBytes))))
                .Skip(offset).Take(pageSize).ToArray();
            var total = context.ListenerStatFlow.AsNoTracking().Join(context.ListenerStatInterval,
                    flow => new { flow.RunId, flow.BucketAt }, interval => new { interval.RunId, interval.BucketAt }, (flow, interval) => new { flow, interval })
                .Where(joined => agentIds.Contains(joined.interval.AgentId) && joined.interval.CapturedAt >= since)
                .Select(joined => new { joined.interval.AgentId, joined.flow.RoomId, joined.flow.SenderBackendUserId, joined.flow.MessageType }).Distinct().LongCount();
            var traffic = context.ListenerStatFlow.AsNoTracking().Join(context.ListenerStatInterval,
                    flow => new { flow.RunId, flow.BucketAt }, interval => new { interval.RunId, interval.BucketAt }, (flow, interval) => new { flow, interval })
                .Where(joined => agentIds.Contains(joined.interval.AgentId) && joined.interval.CapturedAt >= since).GroupBy(joined => joined.interval.AgentId)
                .Select(group => new AgentStatistics(group.Key, new TrafficTotals(group.Sum(joined => joined.flow.Observed), group.Sum(joined => joined.flow.Delivered), group.Sum(joined => joined.flow.ContentBytes),
                    group.Sum(joined => joined.flow.DeliveredBytes), group.Sum(joined => joined.flow.AttachmentBytes), group.Max(joined => joined.flow.LargestBytes)), null)).ToArray();
            var usage = context.ListenerStatUsage.AsNoTracking().Join(context.ListenerStatInterval,
                    sample => new { sample.RunId, sample.BucketAt }, interval => new { interval.RunId, interval.BucketAt }, (sample, interval) => new { sample, interval })
                .Where(joined => agentIds.Contains(joined.interval.AgentId) && joined.interval.CapturedAt >= since).GroupBy(joined => joined.interval.AgentId)
                .Select(group => new UsageAggregate(group.Key, group.Sum(joined => joined.sample.Input), group.Sum(joined => joined.sample.CachedInput), group.Sum(joined => joined.sample.CacheWriteInput ?? 0),
                    group.Sum(joined => joined.sample.CacheWriteInput == null ? 1L : 0L), group.Sum(joined => joined.sample.Output), group.Sum(joined => joined.sample.ReasoningOutput ?? 0),
                    group.Sum(joined => joined.sample.ReasoningOutput == null ? 1L : 0L), group.Sum(joined => joined.sample.Total))).ToArray();
            var trafficById = traffic.ToDictionary(row => row.AgentId, row => row.Totals, StringComparer.Ordinal);
            var usageById = usage.ToDictionary(row => row.AgentId, row => new TokenCounts(row.Input, row.Cached, row.UnknownWrites == 0 ? row.Writes : null,
                row.Output, row.UnknownReasoning == 0 ? row.Reasoning : null, row.Total), StringComparer.Ordinal);
            return new StatisticsSummary(intervals.Sum(row => row.Count), intervals.Sum(row => row.Dropped), intervals.Length == 0 ? null : intervals.Min(row => row.First), intervals.Length == 0 ? null : intervals.Max(row => row.Last),
                traffic.Aggregate(new TrafficTotals(), (sum, row) => Statistics.Add(sum, row.Totals)),
                agentIds.Select(id => new AgentStatistics(id, trafficById.GetValueOrDefault(id) ?? new(), usageById.GetValueOrDefault(id))).ToArray(), flows, total,
                usage.Length == 0 ? null : usageById.Values.Aggregate(new TokenCounts(0, 0, 0, 0, 0, 0), Statistics.Add));
        });

    public static StatisticsPorts Ports(CrossfireDbContext context)
        => new((agent, run, batch, now) => StatisticsCommands.Record(context, agent, run, batch, now), (agents, since, page, size) => Read(context, agents, since, page, size));
}
