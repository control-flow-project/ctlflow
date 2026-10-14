using Crossfire.Kernel;
using System.Text.Json;
using Crossfire.Domain;

namespace Crossfire.Server.Http;

public static class RuntimeViews
{
    public static void Summary(ProtocolWriter writer, RuntimeSummary? value)
    {
        if (value is null) { writer.WriteNullValue(); return; }
        writer.WriteStartObject(); writer.WriteString("state", value.State); writer.WriteNumber("observedAt", value.ObservedAt); JsonValues.Number(writer, "lastActivityAt", value.LastActivityAt);
        if (value.HistoryAvailable is null) writer.WriteNull("historyAvailable"); else writer.WriteBoolean("historyAvailable", value.HistoryAvailable.Value); writer.WriteEndObject();
    }

    public static void Observation(ProtocolWriter writer, RuntimeObservation value)
    {
        writer.WriteStartObject(); writer.WriteString("runId", value.RunId); writer.WriteString("sessionId", value.SessionId); writer.WriteString("roomId", value.RoomId);
        writer.WriteString("runtime", value.Runtime); writer.WriteString("state", value.State); writer.WriteNumber("observedAt", value.ObservedAt); JsonValues.Number(writer, "lastActivityAt", value.LastActivityAt);
        if (value.HistoryAvailable is null) writer.WriteNull("historyAvailable"); else writer.WriteBoolean("historyAvailable", value.HistoryAvailable.Value);
        writer.WriteString("historyMode", value.HistoryMode); writer.WriteNumber("maxInputBytes", value.MaxInputBytes); writer.WriteString("errorMessage", value.ErrorMessage);
        writer.WritePropertyName("settings"); JsonValues.Array(value.Settings, (output, setting) =>
        { output.WriteStartObject(); output.WriteString("name", setting.Name); output.WriteString("configured", setting.Configured); output.WriteString("effective", setting.Effective); output.WriteEndObject(); }).WriteTo(writer);
        writer.WriteEndObject();
    }

    public static void DecisionSummary(ProtocolWriter writer, DecisionSummary value)
    {
        writer.WriteStartObject(); Fields(writer, value.Id, value.AgentId, value.RunId, value.Runtime, value.SessionId, value.RequestId, value.TurnId, value.ItemId, value.Kind, value.Action, value.Blocking, value.ExpiresAt, value.CreatedAt, value.Status); writer.WriteEndObject();
    }

    private static void Fields(ProtocolWriter writer, string id, string agentId, string runId, string runtime, string session, string request, string turn, string item, string kind, string action, bool blocking, long? expires, long created, string status)
    {
        writer.WriteString("id", id); writer.WriteString("agentId", agentId); writer.WriteString("runId", runId); writer.WriteString("runtime", runtime); writer.WriteString("sessionId", session);
        writer.WriteString("requestId", request); writer.WriteString("turnId", turn); writer.WriteString("itemId", item); writer.WriteString("kind", kind); writer.WriteString("action", action);
        writer.WriteBoolean("blocking", blocking); JsonValues.Number(writer, "expiresAt", expires); writer.WriteNumber("createdAt", created); writer.WriteString("status", status);
    }

    public static void Decision(ProtocolWriter writer, DecisionView value)
    {
        var native = value.Native; writer.WriteStartObject();
        Fields(writer, native.Id, value.AgentId, native.RunId, native.Runtime, native.SessionId, native.RequestId, native.TurnId, native.ItemId, native.Kind, native.Action, native.Blocking, native.ExpiresAt, value.CreatedAt, value.Status);
        writer.WriteString("review", native.Review); writer.WritePropertyName("questions"); JsonValues.Array(native.Questions, (output, question) =>
        {
            output.WriteStartObject(); output.WriteString("id", question.Id); output.WriteString("title", question.Title); output.WriteString("prompt", question.Prompt);
            output.WriteBoolean("secret", question.Secret); output.WriteBoolean("allowText", question.AllowText); output.WritePropertyName("options");
            JsonValues.Array(question.Options, (optionWriter, option) => { optionWriter.WriteStartObject(); optionWriter.WriteString("id", option.Id); optionWriter.WriteString("label", option.Label); optionWriter.WriteString("description", option.Description); optionWriter.WriteEndObject(); }).WriteTo(output);
            output.WriteEndObject();
        }).WriteTo(writer); writer.WriteEndObject();
    }

    public static JsonElement Poll(DecisionPoll value) => JsonValues.Object(writer =>
    {
        writer.WriteString("status", value.Status); writer.WritePropertyName("answers"); JsonValues.Array(value.Answers, (output, answer) =>
        { output.WriteStartObject(); output.WriteString("questionId", answer.QuestionId); output.WriteString("optionId", answer.OptionId); output.WriteString("text", answer.Text); output.WriteEndObject(); }).WriteTo(writer);
    });
}
