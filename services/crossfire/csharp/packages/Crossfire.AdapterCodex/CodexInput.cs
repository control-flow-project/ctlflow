using System.Text.Json;
using Crossfire.AdapterRuntime;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public sealed record HistoryBoundary(long Position, string Key);
public sealed record CodexPublication(string? Turn, string Text, string MessageId, HistoryBoundary? Boundary, bool Initializing);
public sealed record CodexInput(string? Turn, string Text, string MessageId, HistoryBoundary? Boundary, bool Initializing, CodexPublication? Resumption = null) : NativeMessage(Text, MessageId)
{
    public CodexPublication Published => Resumption ?? new(Turn, Text, MessageId, Boundary, Initializing);
}

public static class CodexInputCodec
{
    public static readonly NativeCodec<CodexInput> Codec = new(Decode, Encode);
    private static Result<CodexPublication> Publication(JsonElement input, bool outer)
    {
        var fields = Validation.Fields(input, ["turn", "text", "messageId", "boundary", "initializing"], outer ? ["resumption"] : []);
        if (!fields.IsSuccess) return Result<CodexPublication>.Fail(fields.Error);
        var turn = Validation.NullableText(input.GetProperty("turn"), 200); var id = Validation.Text(input.GetProperty("messageId"), 200); var initializing = Validation.Boolean(input.GetProperty("initializing"));
        if (!turn.IsSuccess || !id.IsSuccess || !initializing.IsSuccess || input.GetProperty("text").ValueKind != JsonValueKind.String) return Results.Fail<CodexPublication>("invalid", "Invalid native Codex input");
        var text = ProtocolJson.Unquote(input.GetProperty("text").GetRawText()); if (!text.IsSuccess || System.Text.Encoding.UTF8.GetByteCount(text.Value) > NativeJournal<CodexInput>.MaximumInputBytes) return Results.Fail<CodexPublication>("invalid", "Native delivery text exceeds its byte bound");
        HistoryBoundary? boundary = null; var captured = input.GetProperty("boundary");
        if (captured.ValueKind != JsonValueKind.Null)
        {
            if (!Validation.Fields(captured, ["position", "key"]).IsSuccess) return Results.Fail<CodexPublication>("invalid", "Invalid native Codex history boundary");
            var position = Validation.Integer(captured.GetProperty("position")); var key = Validation.Text(captured.GetProperty("key"), 1000);
            if (!position.IsSuccess || !key.IsSuccess) return Results.Fail<CodexPublication>("invalid", "Invalid native Codex history boundary"); boundary = new(position.Value, key.Value);
        }
        return Result<CodexPublication>.Success(new(turn.Value, text.Value, id.Value, boundary, initializing.Value));
    }
    public static Result<CodexInput> Decode(JsonElement input)
    {
        var original = Publication(input, true); if (!original.IsSuccess) return Result<CodexInput>.Fail(original.Error);
        CodexPublication? resumption = null;
        if (input.TryGetProperty("resumption", out var restarted)) { var parsed = Publication(restarted, false); if (!parsed.IsSuccess) return Result<CodexInput>.Fail(parsed.Error); resumption = parsed.Value; }
        var value = original.Value; return Result<CodexInput>.Success(new(value.Turn, value.Text, value.MessageId, value.Boundary, value.Initializing, resumption));
    }
    public static JsonElement Encode(CodexInput input) => CodexJson.Object(writer =>
    {
        Write(writer, new(input.Turn, input.Text, input.MessageId, input.Boundary, input.Initializing));
        if (input.Resumption is not null) { writer.WriteStartObject("resumption"); Write(writer, input.Resumption); writer.WriteEndObject(); }
    });
    private static void Write(ProtocolWriter writer, CodexPublication input)
    {
        writer.WriteString("turn", input.Turn); writer.WriteString("text", input.Text); writer.WriteString("messageId", input.MessageId);
        if (input.Boundary is null) writer.WriteNull("boundary"); else { writer.WriteStartObject("boundary"); writer.WriteNumber("position", input.Boundary.Position); writer.WriteString("key", input.Boundary.Key); writer.WriteEndObject(); }
        writer.WriteBoolean("initializing", input.Initializing);
    }
}
