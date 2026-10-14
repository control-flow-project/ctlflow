using Crossfire.Kernel;
using System.Text.Json;
using Crossfire.Domain;

namespace Crossfire.Server.Http;

public static class StatisticsViews
{
    public static void Tokens(ProtocolWriter writer, TokenCounts? value)
    {
        if (value is null) { writer.WriteNullValue(); return; }
        writer.WriteStartObject(); writer.WriteNumber("input", value.Input); writer.WriteNumber("cachedInput", value.CachedInput); JsonValues.Number(writer, "cacheWriteInput", value.CacheWriteInput);
        writer.WriteNumber("output", value.Output); JsonValues.Number(writer, "reasoningOutput", value.ReasoningOutput); writer.WriteNumber("total", value.Total); writer.WriteEndObject();
    }

    public static void Totals(ProtocolWriter writer, TrafficTotals value)
    {
        writer.WriteStartObject(); writer.WriteNumber("observed", value.Observed); writer.WriteNumber("delivered", value.Delivered); writer.WriteNumber("contentBytes", value.ContentBytes);
        writer.WriteNumber("deliveredBytes", value.DeliveredBytes); writer.WriteNumber("attachmentBytes", value.AttachmentBytes); writer.WriteNumber("largestBytes", value.LargestBytes); writer.WriteEndObject();
    }

    public static JsonElement Fleet(FleetStatisticsView value) => JsonValues.Object(writer =>
    {
        var summary = value.Summary; var agents = value.Agents.ToDictionary(agent => agent.PrincipalId, StringComparer.Ordinal); var senders = value.Senders.ToDictionary(sender => sender.MatrixUserId, StringComparer.Ordinal);
        writer.WriteNumber("capturedAt", value.CapturedAt); writer.WriteNumber("since", value.Since); writer.WriteNumber("retentionDays", value.RetentionDays);
        writer.WriteNumber("intervals", summary.Intervals); writer.WriteNumber("dropped", summary.Dropped); JsonValues.Number(writer, "firstReportAt", summary.FirstReportAt); JsonValues.Number(writer, "lastReportAt", summary.LastReportAt);
        writer.WritePropertyName("totals"); Totals(writer, summary.Totals); writer.WritePropertyName("tokens"); Tokens(writer, summary.Tokens); writer.WriteNull("spend");
        writer.WriteStartObject("meta"); writer.WriteNumber("page", value.Page); writer.WriteNumber("pageSize", value.PageSize); writer.WriteNumber("totalItems", summary.TotalFlows);
        writer.WriteNumber("totalPages", Math.Max(1, summary.TotalFlows / value.PageSize + (summary.TotalFlows % value.PageSize == 0 ? 0 : 1))); writer.WriteEndObject();
        writer.WritePropertyName("agents"); JsonValues.Array(summary.Agents, (output, agent) =>
        {
            output.WriteStartObject(); output.WriteString("agentId", agent.AgentId); output.WriteString("displayName", agents[agent.AgentId].DisplayName); output.WriteString("matrixUserId", agents[agent.AgentId].MatrixUserId);
            output.WritePropertyName("totals"); Totals(output, agent.Totals); output.WritePropertyName("tokens"); Tokens(output, agent.Tokens); output.WriteEndObject();
        }).WriteTo(writer);
        writer.WritePropertyName("flows"); JsonValues.Array(summary.Flows, (output, flow) =>
        {
            output.WriteStartObject(); output.WriteString("agentId", flow.AgentId); output.WriteString("senderMatrixId", flow.SenderMatrixId); output.WriteString("senderName", senders.GetValueOrDefault(flow.SenderMatrixId)?.DisplayName);
            output.WriteString("roomId", flow.RoomId); output.WriteString("messageType", flow.MessageType); output.WritePropertyName("totals"); Totals(output, flow.Totals); output.WriteEndObject();
        }).WriteTo(writer);
    });
}
