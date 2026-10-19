using System.Globalization;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public static class ReceivedEvents
{
    public static readonly IReadOnlySet<string> Important = MessageCodec.Types.Where(value => value != "other").ToHashSet(StringComparer.Ordinal);
    public static bool Notice(MessageEvent value) => value.Type == "message" && value.Content.Kind == "notice" && value.Content.Control;
    public static bool Notice(ReceivedEvent value) => value.Type == "message" && value.Content.Kind == "notice" && value.Content.Control;
    public static Result<ReceivedEvent> View(MessageEvent value, string room)
    {
        if (!Validation.RoomId(room) || value.RoomId != room || !Validation.EventId(value.EventId) || !Validation.UserId(value.Sender) || !MessageCodec.Types.Contains(value.Type)
            || value.SentAt is < -8640000000000000L or > 8640000000000000L || !MessageCodec.Valid(value.Content)
            || value.SubjectId is { } subject && !MessageCodec.Text(subject, 255, 0)
            || value.Omitted is { } omitted && (omitted.Count > 100 || omitted.Any(field => !MessageCodec.Text(field, 255))))
            return Results.Fail<ReceivedEvent>("invalid", "Invalid normalized messaging event");
        return Result<ReceivedEvent>.Success(new(room, new("unknown", null, null), value.EventId, value.Sender, value.Type, value.Content,
            value.SentAt is { } time ? Time(time) : null, value.SubjectId, value.Omitted));
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
        writer.WriteString("roomId", value.RoomId); writer.WriteStartObject("origin"); writer.WriteString("kind", value.Origin.Kind); writer.WriteString("name", value.Origin.Name); writer.WriteString("alias", value.Origin.Alias); writer.WriteEndObject();
        writer.WriteString("eventId", value.EventId); writer.WriteString("sender", value.Sender); writer.WriteString("type", value.Type); writer.WritePropertyName("content"); MessageJson.Content(value.Content).WriteTo(writer);
        writer.WriteString("subjectId", value.SubjectId); writer.WriteString("timestamp", value.Timestamp);
        if (value.Omitted is not null) { writer.WriteStartArray("omitted"); foreach (var name in value.Omitted) writer.WriteStringValue(name); writer.WriteEndArray(); }
        if (value.ContentFile is { } file) { writer.WriteStartObject("contentFile"); writer.WriteString("file", file.File); writer.WriteNumber("bytes", file.Bytes); writer.WriteString("sha256", file.Sha256); writer.WriteNumber("sourceBytes", file.SourceBytes); writer.WriteNumber("attachmentBytes", file.AttachmentBytes); writer.WriteEndObject(); }
    });
    public static Result<ReceivedEvent> Decode(JsonElement value)
    {
        if (!Validation.Fields(value, ["roomId", "origin", "eventId", "sender", "type", "content", "timestamp", "subjectId"], ["omitted", "contentFile"]).IsSuccess) return Results.Fail<ReceivedEvent>("invalid", "Invalid retained event");
        var origin = value.GetProperty("origin"); if (!Validation.Fields(origin, ["kind", "name", "alias"]).IsSuccess) return Results.Fail<ReceivedEvent>("invalid", "Invalid retained origin");
        var kind = Validation.Choice(origin.GetProperty("kind"), "unknown", "dm", "room"); var name = origin.GetProperty("name").ValueKind == JsonValueKind.Null ? Result<string?>.Success(null) : Validation.PlainText(origin.GetProperty("name"), 16000).Map<string?>(text => text); var alias = Validation.NullableText(origin.GetProperty("alias"));
        var content = MessageCodec.Content(value.GetProperty("content")); var timestamp = Validation.NullableText(value.GetProperty("timestamp"), 40);
        var id = WireJson.Text(value, "eventId"); var room = WireJson.Text(value, "roomId"); var sender = WireJson.Text(value, "sender"); var type = WireJson.Text(value, "type"); var subject = value.GetProperty("subjectId");
        if (id is null || !Validation.EventId(id) || room is null || !Validation.RoomId(room) || sender is null || !Validation.UserId(sender) || type is null || !MessageCodec.Types.Contains(type)
            || !content.IsSuccess || !kind.IsSuccess || !name.IsSuccess || !alias.IsSuccess || !timestamp.IsSuccess || timestamp.Value is not null && !ValidTime(timestamp.Value)
            || subject.ValueKind is not (JsonValueKind.String or JsonValueKind.Null)) return Results.Fail<ReceivedEvent>("invalid", "Invalid retained event identity or timestamp");
        IReadOnlyList<string>? omitted = null; if (value.TryGetProperty("omitted", out var source)) { var list = Validation.List(source, text => Validation.Text(text), 100); if (!list.IsSuccess) return Result<ReceivedEvent>.Fail(list.Error); omitted = list.Value; }
        ContentFile? file = null;
        if (value.TryGetProperty("contentFile", out source))
        {
            if (!Validation.Fields(source, ["file", "bytes", "sha256", "sourceBytes", "attachmentBytes"]).IsSuccess) return Results.Fail<ReceivedEvent>("invalid", "Invalid retained message file");
            var path = Validation.Text(source.GetProperty("file"), 4096); var bytes = Validation.Integer(source.GetProperty("bytes"), 1); var digest = Validation.Text(source.GetProperty("sha256"), 64, 64); var contentBytes = Validation.Integer(source.GetProperty("sourceBytes")); var attachment = Validation.Integer(source.GetProperty("attachmentBytes"));
            if (!path.IsSuccess || !bytes.IsSuccess || !digest.IsSuccess || !contentBytes.IsSuccess || !attachment.IsSuccess || digest.Value.Any(character => character is not (>= '0' and <= '9' or >= 'a' and <= 'f'))) return Results.Fail<ReceivedEvent>("invalid", "Invalid retained message file evidence");
            file = new(path.Value, bytes.Value, digest.Value, contentBytes.Value, attachment.Value);
        }
        return Result<ReceivedEvent>.Success(new(room, new(kind.Value, name.Value, alias.Value), id, sender, type, content.Value, timestamp.Value, subject.ValueKind == JsonValueKind.Null ? null : subject.GetString(), omitted, file));
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
