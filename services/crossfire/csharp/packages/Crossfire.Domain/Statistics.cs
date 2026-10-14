using System.Text;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record TokenCounts(long Input, long CachedInput, long? CacheWriteInput, long Output, long? ReasoningOutput, long Total);
public sealed record UsageSample(string Runtime, string SessionId, TokenCounts Tokens);
public sealed record TrafficTotals(long Observed = 0, long Delivered = 0, long ContentBytes = 0, long DeliveredBytes = 0, long AttachmentBytes = 0, long LargestBytes = 0);
public sealed record TrafficFlow(string RoomId, string SenderMatrixId, string MessageType, TrafficTotals Totals);
public sealed record StatisticsBatch(long Sequence, long StartedAt, long EndedAt, long Dropped, IReadOnlyList<TrafficFlow> Flows, IReadOnlyList<UsageSample> Usage);
public sealed record AgentStatistics(string AgentId, TrafficTotals Totals, TokenCounts? Tokens);
public sealed record StatisticsFlow(string AgentId, string RoomId, string SenderMatrixId, string MessageType, TrafficTotals Totals);
public sealed record StatisticsSummary(long Intervals, long Dropped, long? FirstReportAt, long? LastReportAt, TrafficTotals Totals,
    IReadOnlyList<AgentStatistics> Agents, IReadOnlyList<StatisticsFlow> Flows, long TotalFlows, TokenCounts? Tokens);
public sealed record StatisticsPorts(Func<string, string, StatisticsBatch, long, Result<Unit>> Record,
    Func<IReadOnlyList<string>, long, int, int, Result<StatisticsSummary>> Read);

public static class Statistics
{
    public static string Digest(StatisticsBatch value)
    {
        var output = new StringBuilder("{\"sequence\":").Append(value.Sequence).Append(",\"startedAt\":").Append(value.StartedAt).Append(",\"endedAt\":").Append(value.EndedAt)
            .Append(",\"dropped\":").Append(value.Dropped).Append(",\"flows\":[");
        var first = true;
        foreach (var flow in value.Flows)
        {
            if (!first) output.Append(','); first = false;
            output.Append("{\"roomId\":"); ProtocolJson.String(output, flow.RoomId); output.Append(",\"senderMatrixId\":"); ProtocolJson.String(output, flow.SenderMatrixId);
            output.Append(",\"messageType\":"); ProtocolJson.String(output, flow.MessageType);
            output.Append(",\"observed\":").Append(flow.Totals.Observed).Append(",\"delivered\":").Append(flow.Totals.Delivered).Append(",\"contentBytes\":").Append(flow.Totals.ContentBytes)
                .Append(",\"deliveredBytes\":").Append(flow.Totals.DeliveredBytes).Append(",\"attachmentBytes\":").Append(flow.Totals.AttachmentBytes).Append(",\"largestBytes\":").Append(flow.Totals.LargestBytes).Append('}');
        }
        output.Append("],\"usage\":["); first = true;
        foreach (var sample in value.Usage)
        {
            if (!first) output.Append(','); first = false;
            output.Append("{\"runtime\":"); ProtocolJson.String(output, sample.Runtime); output.Append(",\"sessionId\":"); ProtocolJson.String(output, sample.SessionId);
            var tokens = sample.Tokens; output.Append(",\"tokens\":{\"input\":").Append(tokens.Input).Append(",\"cachedInput\":").Append(tokens.CachedInput)
                .Append(",\"cacheWriteInput\":").Append(tokens.CacheWriteInput?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "null").Append(",\"output\":").Append(tokens.Output)
                .Append(",\"reasoningOutput\":").Append(tokens.ReasoningOutput?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "null").Append(",\"total\":").Append(tokens.Total).Append("}}");
        }
        return Identity.Hash(output.Append("]}").ToString());
    }

    public static TrafficTotals Add(TrafficTotals first, TrafficTotals second)
        => new(checked(first.Observed + second.Observed), checked(first.Delivered + second.Delivered), checked(first.ContentBytes + second.ContentBytes),
            checked(first.DeliveredBytes + second.DeliveredBytes), checked(first.AttachmentBytes + second.AttachmentBytes), Math.Max(first.LargestBytes, second.LargestBytes));

    public static TokenCounts Add(TokenCounts first, TokenCounts second)
        => new(checked(first.Input + second.Input), checked(first.CachedInput + second.CachedInput), first.CacheWriteInput is null || second.CacheWriteInput is null ? null : checked(first.CacheWriteInput + second.CacheWriteInput),
            checked(first.Output + second.Output), first.ReasoningOutput is null || second.ReasoningOutput is null ? null : checked(first.ReasoningOutput + second.ReasoningOutput), checked(first.Total + second.Total));

    public static TokenCounts? Delta(TokenCounts current, TokenCounts? previous)
    {
        if (previous is null) return new(0, 0, null, 0, current.ReasoningOutput is null ? null : 0, 0);
        if (current.Input < previous.Input || current.CachedInput < previous.CachedInput || current.Output < previous.Output || current.Total < previous.Total
            || current.CacheWriteInput < previous.CacheWriteInput || current.ReasoningOutput < previous.ReasoningOutput) return null;
        return new(current.Input - previous.Input, current.CachedInput - previous.CachedInput, current.CacheWriteInput - previous.CacheWriteInput,
            current.Output - previous.Output, current.ReasoningOutput - previous.ReasoningOutput, current.Total - previous.Total);
    }
}
