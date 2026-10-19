using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class StatisticsInputs
{
    public static Result<StatisticsBatch> Batch(JsonElement input)
    {
        var fields = Validation.Fields(input, ["sequence", "startedAt", "endedAt", "dropped", "flows", "usage"]); if (!fields.IsSuccess) return Result<StatisticsBatch>.Fail(fields.Error);
        var sequence = Validation.Integer(input.GetProperty("sequence"), 1); var started = Validation.Integer(input.GetProperty("startedAt"));
        var ended = Validation.Integer(input.GetProperty("endedAt")); var dropped = Validation.Integer(input.GetProperty("dropped"));
        var flows = Validation.List(input.GetProperty("flows"), Flow, 256); var usage = Validation.List(input.GetProperty("usage"), Usage, 32);
        return !sequence.IsSuccess || !started.IsSuccess || !ended.IsSuccess || ended.Value < started.Value || !dropped.IsSuccess || !flows.IsSuccess || !usage.IsSuccess
            || flows.Value.Select(value => (value.RoomId, value.SenderBackendUserId, value.MessageType)).Distinct().Count() != flows.Value.Count
            || usage.Value.Select(value => (value.Runtime, value.SessionId)).Distinct().Count() != usage.Value.Count ? Results.Fail<StatisticsBatch>("invalid", "Invalid interval or duplicate summaries")
            : Result<StatisticsBatch>.Success(new(sequence.Value, started.Value, ended.Value, dropped.Value, flows.Value, usage.Value));
    }

    private static Result<TrafficFlow> Flow(JsonElement input)
    {
        var fields = Validation.Fields(input, ["roomId", "senderBackendUserId", "messageType", "observed", "delivered", "contentBytes", "deliveredBytes", "attachmentBytes", "largestBytes"]);
        if (!fields.IsSuccess) return Result<TrafficFlow>.Fail(fields.Error);
        var room = Validation.Text(input.GetProperty("roomId")); var sender = Validation.Text(input.GetProperty("senderBackendUserId")); var type = Validation.Text(input.GetProperty("messageType"), 100);
        var counts = new[] { "observed", "delivered", "contentBytes", "deliveredBytes", "attachmentBytes", "largestBytes" }.Select(name => Validation.Integer(input.GetProperty(name))).ToArray();
        return !room.IsSuccess || !Validation.RoomId(room.Value) || !sender.IsSuccess || !Validation.UserId(sender.Value) || !type.IsSuccess || counts.Any(value => !value.IsSuccess)
            ? Results.Fail<TrafficFlow>("invalid", "Invalid bounded traffic counters") : Result<TrafficFlow>.Success(new(room.Value, sender.Value, type.Value,
                new(counts[0].Value, counts[1].Value, counts[2].Value, counts[3].Value, counts[4].Value, counts[5].Value)));
    }

    private static Result<UsageSample> Usage(JsonElement input)
    {
        var fields = Validation.Fields(input, ["runtime", "sessionId", "tokens"]); if (!fields.IsSuccess) return Result<UsageSample>.Fail(fields.Error);
        var runtime = Validation.Text(input.GetProperty("runtime"), 100); var session = Validation.Text(input.GetProperty("sessionId")); var tokens = Tokens(input.GetProperty("tokens"));
        return !runtime.IsSuccess || !session.IsSuccess || !tokens.IsSuccess ? Results.Fail<UsageSample>("invalid", "Invalid usage summary") : Result<UsageSample>.Success(new(runtime.Value, session.Value, tokens.Value));
    }

    private static Result<TokenCounts> Tokens(JsonElement input)
    {
        var fields = Validation.Fields(input, ["input", "cachedInput", "cacheWriteInput", "output", "reasoningOutput", "total"]); if (!fields.IsSuccess) return Result<TokenCounts>.Fail(fields.Error);
        var incoming = Validation.Integer(input.GetProperty("input")); var cached = Validation.Integer(input.GetProperty("cachedInput")); var writes = Validation.NullableInteger(input.GetProperty("cacheWriteInput"));
        var outgoing = Validation.Integer(input.GetProperty("output")); var reasoning = Validation.NullableInteger(input.GetProperty("reasoningOutput")); var total = Validation.Integer(input.GetProperty("total"));
        return !incoming.IsSuccess || !cached.IsSuccess || !writes.IsSuccess || !outgoing.IsSuccess || !reasoning.IsSuccess || !total.IsSuccess || cached.Value > incoming.Value
            || writes.Value > incoming.Value || reasoning.Value > outgoing.Value ? Results.Fail<TokenCounts>("invalid", "Token subsets exceed their parent counts")
            : Result<TokenCounts>.Success(new(incoming.Value, cached.Value, writes.Value, outgoing.Value, reasoning.Value, total.Value));
    }
}
