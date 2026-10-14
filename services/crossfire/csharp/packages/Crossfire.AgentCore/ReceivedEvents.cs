using System.Globalization;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public static class ReceivedEvents
{
    public static readonly IReadOnlySet<string> Important = new HashSet<string>(StringComparer.Ordinal) { "m.room.message", "m.room.encrypted", "m.room.redaction", "m.room.name", "m.room.topic", "m.room.member", "m.room.power_levels", "m.room.join_rules", "m.room.history_visibility", "m.room.encryption", "m.room.tombstone" };
    public static bool Notice(JsonElement value) => WireJson.Text(value, "type") == "m.room.message" && value.TryGetProperty("content", out var content) && WireJson.Text(content, "msgtype") == "m.notice"
        && content.TryGetProperty("org.crossfire.listener_notice", out var marker) && marker.ValueKind == JsonValueKind.True;
    public static bool Notice(ReceivedEvent value) => value.Type == "m.room.message" && WireJson.Text(value.Content, "msgtype") == "m.notice" && value.Content.TryGetProperty("org.crossfire.listener_notice", out var marker) && marker.ValueKind == JsonValueKind.True;
    public static Result<ReceivedEvent> View(JsonElement value, string room)
    {
        var id = WireJson.Text(value, "event_id"); var sender = WireJson.Text(value, "sender"); var type = WireJson.Text(value, "type");
        if (!Validation.RoomId(room) || id is null || !Validation.EventId(id) || sender is null || !Validation.UserId(sender) || type is null || !value.TryGetProperty("content", out var content)
            || content.ValueKind != JsonValueKind.Object || !Validation.Json(content) || value.TryGetProperty("state_key", out var stateKey) && stateKey.ValueKind != JsonValueKind.String)
            return Results.Fail<ReceivedEvent>("invalid", "Invalid Matrix event identity or content");
        string? timestamp = null;
        if (value.TryGetProperty("origin_server_ts", out var time))
        {
            var parsed = Validation.Integer(time, -8640000000000000, 8640000000000000); if (!parsed.IsSuccess) return Result<ReceivedEvent>.Fail(parsed.Error);
            timestamp = Time(parsed.Value);
        }
        var omit = WireJson.Text(content, "body") is not null && content.TryGetProperty("formatted_body", out _);
        var projected = omit ? WireJson.Object(writer => { foreach (var field in content.EnumerateObject()) if (field.Name != "formatted_body") field.WriteTo(writer); }) : content.Clone();
        return Result<ReceivedEvent>.Success(new(room, new("unknown", null, null), id, sender, type, projected, timestamp, WireJson.Text(value, "state_key"), omit ? ["content.formatted_body"] : null));
    }
    private static string Time(long milliseconds)
    {
        const long day = 86400000; var days = Math.DivRem(milliseconds, day, out var part); if (part < 0) { days--; part += day; }
        var shifted = days + 719468; var era = (shifted >= 0 ? shifted : shifted - 146096) / 146097; var dayOfEra = shifted - era * 146097;
        var yearOfEra = (dayOfEra - dayOfEra / 1460 + dayOfEra / 36524 - dayOfEra / 146096) / 365; var year = yearOfEra + era * 400;
        var dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100); var monthPart = (5 * dayOfYear + 2) / 153;
        var date = dayOfYear - (153 * monthPart + 2) / 5 + 1; var month = monthPart + (monthPart < 10 ? 3 : -9); year += month <= 2 ? 1 : 0;
        var prefix = year is >= 0 and <= 9999 ? year.ToString("D4", CultureInfo.InvariantCulture) : (year < 0 ? "-" : "+") + Math.Abs(year).ToString("D6", CultureInfo.InvariantCulture);
        return prefix + "-" + month.ToString("D2", CultureInfo.InvariantCulture) + "-" + date.ToString("D2", CultureInfo.InvariantCulture) + "T" + (part / 3600000).ToString("D2", CultureInfo.InvariantCulture)
            + ":" + (part / 60000 % 60).ToString("D2", CultureInfo.InvariantCulture) + ":" + (part / 1000 % 60).ToString("D2", CultureInfo.InvariantCulture) + "." + (part % 1000).ToString("D3", CultureInfo.InvariantCulture) + "Z";
    }
    public static JsonElement Encode(ReceivedEvent value) => WireJson.Object(writer =>
    {
        writer.WriteString("room_id", value.RoomId); writer.WritePropertyName("origin"); writer.WriteStartObject(); writer.WriteString("kind", value.Origin.Kind); writer.WriteString("name", value.Origin.Name); writer.WriteString("alias", value.Origin.Alias); writer.WriteEndObject();
        writer.WriteString("event_id", value.EventId); writer.WriteString("sender", value.Sender); writer.WriteString("type", value.Type); writer.WritePropertyName("content"); value.Content.WriteTo(writer);
        if (value.StateKey is not null) writer.WriteString("state_key", value.StateKey);
        if (value.Omitted is not null) { writer.WriteStartArray("omitted"); foreach (var name in value.Omitted) writer.WriteStringValue(name); writer.WriteEndArray(); }
        writer.WriteString("timestamp", value.Timestamp);
        if (value.ContentFile is { } file) { writer.WriteStartObject("content_file"); writer.WriteString("file", file.File); writer.WriteNumber("bytes", file.Bytes); writer.WriteString("sha256", file.Sha256); writer.WriteNumber("sourceBytes", file.SourceBytes); writer.WriteNumber("attachmentBytes", file.AttachmentBytes); writer.WriteEndObject(); }
    });
    public static Result<ReceivedEvent> Decode(JsonElement value)
    {
        if (!Validation.Fields(value, ["room_id", "origin", "event_id", "sender", "type", "content", "timestamp"], ["state_key", "omitted", "content_file"]).IsSuccess) return Results.Fail<ReceivedEvent>("invalid", "Invalid retained event");
        var origin = value.GetProperty("origin"); if (!Validation.Fields(origin, ["kind", "name", "alias"]).IsSuccess) return Results.Fail<ReceivedEvent>("invalid", "Invalid retained origin");
        var kind = Validation.Choice(origin.GetProperty("kind"), "unknown", "dm", "room"); var name = origin.GetProperty("name").ValueKind == JsonValueKind.Null ? Result<string?>.Success(null) : Validation.PlainText(origin.GetProperty("name"), 16000).Map<string?>(text => text); var alias = Validation.NullableText(origin.GetProperty("alias"));
        var native = WireJson.Object(writer => { writer.WriteString("event_id", WireJson.Text(value, "event_id")); writer.WriteString("sender", WireJson.Text(value, "sender")); writer.WriteString("type", WireJson.Text(value, "type")); writer.WritePropertyName("content"); value.GetProperty("content").WriteTo(writer); if (value.TryGetProperty("state_key", out var key)) { writer.WritePropertyName("state_key"); key.WriteTo(writer); } });
        var parsed = View(native, WireJson.Text(value, "room_id") ?? ""); var timestamp = Validation.NullableText(value.GetProperty("timestamp"), 40);
        if (!parsed.IsSuccess || !kind.IsSuccess || !name.IsSuccess || !alias.IsSuccess || !timestamp.IsSuccess || timestamp.Value is not null && !ValidTime(timestamp.Value)) return Results.Fail<ReceivedEvent>("invalid", "Invalid retained event identity or timestamp");
        IReadOnlyList<string>? omitted = null; if (value.TryGetProperty("omitted", out var source)) { var list = Validation.List(source, text => Validation.Text(text), 100); if (!list.IsSuccess) return Result<ReceivedEvent>.Fail(list.Error); omitted = list.Value; }
        ContentFile? file = null;
        if (value.TryGetProperty("content_file", out source))
        {
            if (!Validation.Fields(source, ["file", "bytes", "sha256", "sourceBytes", "attachmentBytes"]).IsSuccess) return Results.Fail<ReceivedEvent>("invalid", "Invalid retained message file");
            var path = Validation.Text(source.GetProperty("file"), 4096); var bytes = Validation.Integer(source.GetProperty("bytes"), 1); var digest = Validation.Text(source.GetProperty("sha256"), 64, 64); var contentBytes = Validation.Integer(source.GetProperty("sourceBytes")); var attachment = Validation.Integer(source.GetProperty("attachmentBytes"));
            if (!path.IsSuccess || !bytes.IsSuccess || !digest.IsSuccess || !contentBytes.IsSuccess || !attachment.IsSuccess || digest.Value.Any(character => character is not (>= '0' and <= '9' or >= 'a' and <= 'f'))) return Results.Fail<ReceivedEvent>("invalid", "Invalid retained message file evidence");
            file = new(path.Value, bytes.Value, digest.Value, contentBytes.Value, attachment.Value);
        }
        return parsed.Map(item => item with { Origin = new(kind.Value, name.Value, alias.Value), Timestamp = timestamp.Value, Omitted = omitted, ContentFile = file });
    }
    private static bool ValidTime(string value)
    {
        var offset = value.StartsWith('+') || value.StartsWith('-') ? 3 : 0;
        if (value.Length != 24 + offset || value[4 + offset] != '-' || value[7 + offset] != '-' || value[10 + offset] != 'T' || value[13 + offset] != ':' || value[16 + offset] != ':' || value[19 + offset] != '.' || value[^1] != 'Z') return false;
        var yearText = value[..(4 + offset)]; if (!long.TryParse(yearText, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var year)) return false;
        if (offset != 0 && year is >= 0 and <= 9999 || year is < -271821 or > 275760) return false;
        var fields = new[] { value.Substring(5 + offset, 2), value.Substring(8 + offset, 2), value.Substring(11 + offset, 2), value.Substring(14 + offset, 2), value.Substring(17 + offset, 2), value.Substring(20 + offset, 3) };
        if (fields.Any(field => field.Any(character => character is < '0' or > '9'))) return false;
        var numbers = fields.Select(field => int.Parse(field, CultureInfo.InvariantCulture)).ToArray(); var month = numbers[0];
        var leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0); var days = month == 2 ? leap ? 29 : 28 : month is 4 or 6 or 9 or 11 ? 30 : 31;
        if (month is < 1 or > 12 || numbers[1] < 1 || numbers[1] > days || numbers[2] > 23 || numbers[3] > 59 || numbers[4] > 59) return false;
        return (year > -271821 || string.CompareOrdinal(value[7..], "-04-20T00:00:00.000Z") >= 0) && (year < 275760 || string.CompareOrdinal(value[7..], "-09-13T00:00:00.000Z") <= 0);
    }
}
