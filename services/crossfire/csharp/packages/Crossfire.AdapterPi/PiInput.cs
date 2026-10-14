using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterRuntime;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterPi;

public sealed record PiPublication(string Text, string MessageId, NativeFileBoundary Boundary, bool Published);
public sealed record PiInput(string Text, string MessageId, NativeFileBoundary Boundary, bool Published, PiPublication? Resumption = null) : NativeMessage(Text, MessageId)
{ public PiPublication Effective => Resumption ?? new(Text, MessageId, Boundary, Published); }

public static class PiInputCodec
{
    public static readonly NativeCodec<PiInput> Codec = new(Decode, Encode);
    private static Result<PiPublication> Publication(JsonElement value, bool outer)
    {
        if (!Validation.Fields(value, ["messageId", "text", "boundary", "published"], outer ? ["resumption"] : []).IsSuccess || value.GetProperty("text").ValueKind != JsonValueKind.String)
            return Results.Fail<PiPublication>("invalid", "Invalid native Pi input publication");
        var id = Validation.Text(value.GetProperty("messageId"), 200); var text = ProtocolJson.Unquote(value.GetProperty("text").GetRawText()); var published = Validation.Boolean(value.GetProperty("published")); var boundary = value.GetProperty("boundary");
        if (!id.IsSuccess || !text.IsSuccess || !published.IsSuccess || !Validation.Fields(boundary, ["key", "position", "prefix"]).IsSuccess) return Results.Fail<PiPublication>("invalid", "Invalid native Pi input evidence");
        var key = Validation.Text(boundary.GetProperty("key"), 100); var position = Validation.Integer(boundary.GetProperty("position")); var prefix = Validation.Text(boundary.GetProperty("prefix"), 64, 64);
        if (!key.IsSuccess || !position.IsSuccess || !prefix.IsSuccess || prefix.Value.Any(character => character is not (>= '0' and <= '9' or >= 'a' and <= 'f')))
            return Results.Fail<PiPublication>("invalid", "Invalid native Pi history boundary");
        return Result<PiPublication>.Success(new(text.Value, id.Value, new(key.Value, position.Value, prefix.Value), published.Value));
    }
    public static Result<PiInput> Decode(JsonElement value)
    {
        var original = Publication(value, true); if (!original.IsSuccess) return Result<PiInput>.Fail(original.Error); PiPublication? resumption = null;
        if (value.TryGetProperty("resumption", out var next))
        {
            var parsed = Publication(next, false); if (!parsed.IsSuccess) return Result<PiInput>.Fail(parsed.Error); resumption = parsed.Value;
            if (System.Text.Encoding.UTF8.GetByteCount(resumption.Text) > NativeJournal<PiInput>.MaximumInputBytes) return Results.Fail<PiInput>("invalid", "Native Pi resumption text exceeds its exact byte bound");
        }
        var input = new PiInput(original.Value.Text, original.Value.MessageId, original.Value.Boundary, original.Value.Published, resumption);
        return NativeJournal<PiInput>.ValidateMessage(input).Map(_ => input);
    }
    public static JsonElement Encode(PiInput value) => PiValues.Object(writer =>
    { Write(writer, new(value.Text, value.MessageId, value.Boundary, value.Published)); if (value.Resumption is not null) { writer.WriteStartObject("resumption"); Write(writer, value.Resumption); writer.WriteEndObject(); } });
    private static void Write(ProtocolWriter writer, PiPublication value)
    {
        writer.WriteString("messageId", value.MessageId); writer.WriteString("text", value.Text); writer.WriteStartObject("boundary"); writer.WriteString("key", value.Boundary.Key);
        writer.WriteNumber("position", value.Boundary.Position); writer.WriteString("prefix", value.Boundary.Prefix); writer.WriteEndObject(); writer.WriteBoolean("published", value.Published);
    }
}
