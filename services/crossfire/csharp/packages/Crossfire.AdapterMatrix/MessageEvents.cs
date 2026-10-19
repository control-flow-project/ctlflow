using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public static class MessageEvents
{
    public static readonly IReadOnlyDictionary<string, string> Types = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["m.room.message"] = "message", ["m.room.member"] = "membership", ["m.room.name"] = "name", ["m.room.topic"] = "topic",
        ["m.room.power_levels"] = "access", ["m.room.join_rules"] = "join-policy", ["m.room.history_visibility"] = "history-policy",
        ["m.room.encryption"] = "encryption", ["m.room.encrypted"] = "encrypted", ["m.room.redaction"] = "redaction", ["m.room.tombstone"] = "migration"
    };

    public static Result<MessageEvent> Parse(JsonElement value, string room)
    {
        var id = WireJson.Text(value, "event_id"); var sender = WireJson.Text(value, "sender"); var type = WireJson.Text(value, "type");
        if (!MatrixSyntax.RoomId(room) || id is null || !MatrixSyntax.EventId(id) || sender is null || !MatrixSyntax.UserId(sender) || type is null
            || value.TryGetProperty("room_id", out var roomId) && (roomId.ValueKind != JsonValueKind.String || roomId.GetString() != room)
            || !value.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Object || !Validation.Json(content)
            || value.TryGetProperty("state_key", out var subject) && subject.ValueKind != JsonValueKind.String)
            return Results.Fail<MessageEvent>("native", "Invalid Matrix event identity or content");
        long? sentAt = null;
        if (value.TryGetProperty("origin_server_ts", out var time))
        {
            var parsed = Validation.Integer(time, -8640000000000000L, 8640000000000000L);
            if (!parsed.IsSuccess) return Result<MessageEvent>.Fail(parsed.Error);
            sentAt = parsed.Value;
        }
        var mentions = new List<string>();
        if (content.TryGetProperty("m.mentions", out var mentioned) && mentioned.ValueKind == JsonValueKind.Object
            && mentioned.TryGetProperty("user_ids", out var users) && users.ValueKind == JsonValueKind.Array)
            foreach (var user in users.EnumerateArray())
            {
                if (user.ValueKind != JsonValueKind.String || !MatrixSyntax.UserId(user.GetString()!)) return Results.Fail<MessageEvent>("native", "Invalid Matrix mention identities");
                mentions.Add(user.GetString()!);
            }
        var kind = WireJson.Text(content, "msgtype") switch
        {
            "m.text" => "text", "m.notice" => "notice", "m.image" => "image", "m.file" => "file", "m.audio" => "audio", "m.video" => "video", "m.location" => "location", _ => "other"
        };
        var body = WireJson.Text(content, "body");
        var edited = content.TryGetProperty("m.new_content", out _) || content.TryGetProperty("m.relates_to", out var relation) && WireJson.Text(relation, "rel_type") == "m.replace";
        var control = type == "m.room.message" && kind == "notice" && content.TryGetProperty("org.crossfire.listener_notice", out var marker) && marker.ValueKind == JsonValueKind.True;
        var attachments = new List<MessageAttachment>();
        if (kind is "image" or "file" or "audio" or "video" && WireJson.Text(content, "url") is { } url)
        {
            var info = content.TryGetProperty("info", out var metadata) ? metadata : default;
            long? bytes = null;
            if (info.ValueKind == JsonValueKind.Object && info.TryGetProperty("size", out var size)) { var parsed = Validation.Integer(size); if (parsed.IsSuccess) bytes = parsed.Value; }
            attachments.Add(new(url, body, WireJson.Text(info, "mimetype"), bytes));
        }
        var attributes = WireJson.Object(writer =>
        {
            writer.WriteString("eventType", type); writer.WriteStartObject("content");
            foreach (var field in content.EnumerateObject())
                if (field.Name is not ("body" or "msgtype" or "m.mentions" or "org.crossfire.listener_notice") && (body is null || field.Name != "formatted_body")) field.WriteTo(writer);
            writer.WriteEndObject();
        });
        return Result<MessageEvent>.Success(new(id, room, sender, Types.GetValueOrDefault(type, "other"), new(kind, body, mentions, edited, control, attachments, attributes),
            value.TryGetProperty("state_key", out subject) ? subject.GetString() : null, sentAt,
            body is not null && content.TryGetProperty("formatted_body", out _) ? ["content.formatted_body"] : null));
    }
}
