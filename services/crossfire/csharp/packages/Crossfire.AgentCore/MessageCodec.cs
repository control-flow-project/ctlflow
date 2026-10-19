using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public static class MessageCodec
{
    public static bool Valid(MessageContent value) => value.Kind is "text" or "notice" or "image" or "file" or "audio" or "video" or "location" or "other"
        && (value.Body is null || TextRules.WellFormed(value.Body)) && value.Mentions.Count <= 2000 && value.Mentions.All(Validation.UserId)
        && value.Attachments.Count <= 1000 && value.Attachments.All(item => Text(item.Id, 4096)
            && (item.Name is null || Text(item.Name, 4096, 0))
            && (item.MediaType is null || Text(item.MediaType, 255))
            && (item.Bytes is null or >= 0 and <= Validation.MaxWireInteger))
        && value.Attributes.ValueKind == JsonValueKind.Object && Validation.Json(value.Attributes);
    internal static bool Text(string value, int maximum, int minimum = 1) => value.Length >= minimum && value.Length <= maximum
        && TextRules.WellFormed(value) && !value.Any(character => character is <= '\u001f' or '\u007f');
    public static readonly IReadOnlySet<string> Types = new HashSet<string>(StringComparer.Ordinal)
        { "message", "membership", "name", "topic", "access", "join-policy", "history-policy", "encryption", "encrypted", "redaction", "migration", "other" };
    public static Result<MessageContent> Content(JsonElement value)
    {
        if (!Validation.Fields(value, ["kind", "body", "mentions", "edited", "control", "attachments", "attributes"]).IsSuccess)
            return Results.Fail<MessageContent>("invalid", "Invalid normalized message content");
        var kind = Validation.Choice(value.GetProperty("kind"), "text", "notice", "image", "file", "audio", "video", "location", "other");
        var body = value.GetProperty("body"); var mentions = Validation.List(value.GetProperty("mentions"), source =>
            Validation.Text(source).Bind(identity => Validation.UserId(identity) ? Result<string>.Success(identity) : Results.Fail<string>("invalid", "Invalid mentioned identity")), 2000);
        var edited = Validation.Boolean(value.GetProperty("edited")); var control = Validation.Boolean(value.GetProperty("control"));
        var attachments = Validation.List(value.GetProperty("attachments"), source =>
        {
            if (!Validation.Fields(source, ["id", "name", "mediaType", "bytes"]).IsSuccess) return Results.Fail<MessageAttachment>("invalid", "Invalid attachment metadata");
            var id = Validation.Text(source.GetProperty("id"), 4096); var name = source.GetProperty("name").ValueKind == JsonValueKind.Null ? Result<string?>.Success(null)
                : Validation.Text(source.GetProperty("name"), 4096, 0).Map<string?>(text => text);
            var media = Validation.NullableText(source.GetProperty("mediaType")); var bytes = Validation.NullableInteger(source.GetProperty("bytes"));
            return id.IsSuccess && name.IsSuccess && media.IsSuccess && bytes.IsSuccess ? Result<MessageAttachment>.Success(new(id.Value, name.Value, media.Value, bytes.Value))
                : Results.Fail<MessageAttachment>("invalid", "Invalid attachment fields");
        }, 1000);
        var attributes = value.GetProperty("attributes");
        if (!kind.IsSuccess || body.ValueKind is not (JsonValueKind.String or JsonValueKind.Null) || body.ValueKind == JsonValueKind.String && !TextRules.WellFormed(body.GetString()!)
            || !mentions.IsSuccess || !edited.IsSuccess || !control.IsSuccess || !attachments.IsSuccess || attributes.ValueKind != JsonValueKind.Object || !Validation.Json(attributes))
            return Results.Fail<MessageContent>("invalid", "Invalid normalized message fields");
        return Result<MessageContent>.Success(new(kind.Value, body.ValueKind == JsonValueKind.Null ? null : ProtocolJson.Unquote(body.GetRawText()).Value,
            mentions.Value, edited.Value, control.Value, attachments.Value, attributes.Clone()));
    }
    public static Result<MessageEvent> Event(JsonElement value)
    {
        if (!Validation.Fields(value, ["eventId", "roomId", "sender", "type", "content", "subjectId", "sentAt"], ["omitted"]).IsSuccess)
            return Results.Fail<MessageEvent>("invalid", "Invalid normalized event");
        var id = WireJson.Text(value, "eventId"); var room = WireJson.Text(value, "roomId"); var sender = WireJson.Text(value, "sender"); var type = WireJson.Text(value, "type");
        var content = Content(value.GetProperty("content")); var subject = value.GetProperty("subjectId"); var time = value.GetProperty("sentAt");
        var sent = time.ValueKind == JsonValueKind.Null ? Result<long?>.Success(null) : Validation.Integer(time, -8640000000000000L, 8640000000000000L).Map<long?>(number => number);
        if (id is null || !Validation.EventId(id) || room is null || !Validation.RoomId(room) || sender is null || !Validation.UserId(sender) || type is null || !Types.Contains(type)
            || !content.IsSuccess || !sent.IsSuccess || subject.ValueKind is not (JsonValueKind.Null or JsonValueKind.String)
            || subject.ValueKind == JsonValueKind.String && !Validation.Text(subject, 255, 0).IsSuccess)
            return Results.Fail<MessageEvent>("invalid", "Invalid normalized event fields");
        var omitted = value.TryGetProperty("omitted", out var fields) ? Validation.List(fields, field => Validation.Text(field, 255), 100).Map<IReadOnlyList<string>?>(items => items) : Result<IReadOnlyList<string>?>.Success(null);
        return omitted.IsSuccess ? Result<MessageEvent>.Success(new(id, room, sender, type, content.Value, subject.ValueKind == JsonValueKind.Null ? null : subject.GetString(), sent.Value, omitted.Value))
            : Result<MessageEvent>.Fail(omitted.Error);
    }
}
