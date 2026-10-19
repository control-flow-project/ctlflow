using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public static class AgentWire
{
    public static JsonElement Statistics(StatisticsBatch batch) => WireJson.Object(writer =>
    {
        writer.WriteNumber("sequence", batch.Sequence); writer.WriteNumber("startedAt", batch.StartedAt); writer.WriteNumber("endedAt", batch.EndedAt); writer.WriteNumber("dropped", batch.Dropped); writer.WriteStartArray("flows");
        foreach (var flow in batch.Flows)
        {
            writer.WriteStartObject(); writer.WriteString("roomId", flow.RoomId); writer.WriteString("senderBackendUserId", flow.SenderBackendUserId); writer.WriteString("messageType", flow.MessageType);
            writer.WriteNumber("observed", flow.Totals.Observed); writer.WriteNumber("delivered", flow.Totals.Delivered); writer.WriteNumber("contentBytes", flow.Totals.ContentBytes); writer.WriteNumber("deliveredBytes", flow.Totals.DeliveredBytes); writer.WriteNumber("attachmentBytes", flow.Totals.AttachmentBytes); writer.WriteNumber("largestBytes", flow.Totals.LargestBytes); writer.WriteEndObject();
        }
        writer.WriteEndArray(); writer.WriteStartArray("usage");
        foreach (var sample in batch.Usage)
        {
            writer.WriteStartObject(); writer.WriteString("runtime", sample.Runtime); writer.WriteString("sessionId", sample.SessionId); writer.WriteStartObject("tokens"); writer.WriteNumber("input", sample.Tokens.Input); writer.WriteNumber("cachedInput", sample.Tokens.CachedInput);
            Number(writer, "cacheWriteInput", sample.Tokens.CacheWriteInput); writer.WriteNumber("output", sample.Tokens.Output); Number(writer, "reasoningOutput", sample.Tokens.ReasoningOutput); writer.WriteNumber("total", sample.Tokens.Total); writer.WriteEndObject(); writer.WriteEndObject();
        }
        writer.WriteEndArray();
    });
    public static JsonElement Observation(RuntimeObservation value) => WireJson.Object(writer =>
    {
        writer.WriteString("runtime", value.Runtime); writer.WriteString("sessionId", value.SessionId); writer.WriteString("roomId", value.RoomId); writer.WriteString("state", value.State); writer.WriteNumber("observedAt", value.ObservedAt);
        Number(writer, "lastActivityAt", value.LastActivityAt); if (value.HistoryAvailable is { } history) writer.WriteBoolean("historyAvailable", history); else writer.WriteNull("historyAvailable");
        writer.WriteString("historyMode", value.HistoryMode); writer.WriteNumber("maxInputBytes", value.MaxInputBytes); writer.WriteStartArray("settings");
        foreach (var setting in value.Settings) { writer.WriteStartObject(); writer.WriteString("name", setting.Name); writer.WriteString("configured", setting.Configured); writer.WriteString("effective", setting.Effective); writer.WriteEndObject(); }
        writer.WriteEndArray(); writer.WriteString("errorMessage", value.ErrorMessage);
    });
    public static Result<RuntimeObservation> Observation(JsonElement value)
    {
        if (!Validation.Fields(value, ["runtime", "sessionId", "roomId", "state", "observedAt", "lastActivityAt", "historyAvailable", "historyMode", "maxInputBytes", "settings", "errorMessage"]).IsSuccess) return Results.Fail<RuntimeObservation>("invalid", "Invalid retained runtime observation");
        var runtime = Validation.Choice(value.GetProperty("runtime"), "codex", "pi"); var session = Validation.Text(value.GetProperty("sessionId"), 255); var room = Validation.NullableText(value.GetProperty("roomId"));
        var state = Validation.Choice(value.GetProperty("state"), "failed", "waiting-approval", "waiting-answer", "waking", "working", "unavailable", "idle", "sleeping"); var observed = Validation.Integer(value.GetProperty("observedAt")); var activity = Validation.NullableInteger(value.GetProperty("lastActivityAt"));
        var history = value.GetProperty("historyAvailable"); var mode = Validation.Choice(value.GetProperty("historyMode"), "shared", "per-room"); var maximum = Validation.Integer(value.GetProperty("maxInputBytes"), 1, AgentIO.MaximumInputBytes); var error = Validation.NullableText(value.GetProperty("errorMessage"), 4000);
        var settings = Validation.List(value.GetProperty("settings"), source =>
        {
            if (!Validation.Fields(source, ["name", "configured", "effective"]).IsSuccess) return Results.Fail<RuntimeSetting>("invalid", "Invalid retained runtime setting");
            var name = Validation.Choice(source.GetProperty("name"), "model", "model_reasoning_effort", "sandbox_mode", "approval_policy", "native_version", "dangerously_bypass_approvals_and_sandbox", "features.default_mode_request_user_input", "provider", "thinking_level");
            var configured = Validation.NullableText(source.GetProperty("configured")); var effective = Validation.NullableText(source.GetProperty("effective"));
            return name.IsSuccess && configured.IsSuccess && effective.IsSuccess ? Result<RuntimeSetting>.Success(new(name.Value, configured.Value, effective.Value)) : Results.Fail<RuntimeSetting>("invalid", "Invalid retained runtime setting");
        }, 16);
        if (!runtime.IsSuccess || !session.IsSuccess || !room.IsSuccess || room.Value is not null && !Validation.RoomId(room.Value) || !state.IsSuccess || !observed.IsSuccess || !activity.IsSuccess || history.ValueKind is not (JsonValueKind.True or JsonValueKind.False or JsonValueKind.Null) || !mode.IsSuccess || !maximum.IsSuccess || !error.IsSuccess || !settings.IsSuccess || settings.Value.Select(setting => setting.Name).Distinct(StringComparer.Ordinal).Count() != settings.Value.Count) return Results.Fail<RuntimeObservation>("invalid", "Invalid retained runtime observation fields");
        return Result<RuntimeObservation>.Success(new("", session.Value, room.Value, runtime.Value, state.Value, observed.Value, activity.Value, history.ValueKind == JsonValueKind.Null ? null : history.GetBoolean(), mode.Value, maximum.Value, settings.Value, error.Value));
    }
    public static JsonElement Questions(IReadOnlyList<DecisionQuestion> questions) => WireJson.Array(writer =>
    {
        foreach (var question in questions)
        {
            writer.WriteStartObject(); writer.WriteString("id", question.Id); writer.WriteString("title", question.Title); writer.WriteString("prompt", question.Prompt); writer.WriteBoolean("secret", question.Secret); writer.WriteBoolean("allowText", question.AllowText); writer.WriteStartArray("options");
            foreach (var option in question.Options) { writer.WriteStartObject(); writer.WriteString("id", option.Id); writer.WriteString("label", option.Label); writer.WriteString("description", option.Description); writer.WriteEndObject(); }
            writer.WriteEndArray(); writer.WriteEndObject();
        }
    });
    public static void Number(ProtocolWriter writer, string key, long? number) { if (number is { } present) writer.WriteNumber(key, present); else writer.WriteNull(key); }
    public static string Segment(string value) => Uri.EscapeDataString(value);
}
