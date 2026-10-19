using System.Text.Json;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class MessageJson
{
    public static JsonElement Content(MessageContent value) => WireJson.Object(writer =>
    {
        writer.WriteString("kind", value.Kind); writer.WriteString("body", value.Body); writer.WriteStartArray("mentions");
        foreach (var user in value.Mentions) writer.WriteStringValue(user); writer.WriteEndArray();
        writer.WriteBoolean("edited", value.Edited); writer.WriteBoolean("control", value.Control); writer.WriteStartArray("attachments");
        foreach (var file in value.Attachments)
        {
            writer.WriteStartObject(); writer.WriteString("id", file.Id); writer.WriteString("name", file.Name); writer.WriteString("mediaType", file.MediaType);
            if (file.Bytes is { } bytes) writer.WriteNumber("bytes", bytes); else writer.WriteNull("bytes"); writer.WriteEndObject();
        }
        writer.WriteEndArray(); writer.WritePropertyName("attributes"); value.Attributes.WriteTo(writer);
    });
    public static JsonElement Event(MessageEvent value) => WireJson.Object(writer =>
    {
        writer.WriteString("eventId", value.EventId); writer.WriteString("roomId", value.RoomId); writer.WriteString("sender", value.Sender);
        writer.WriteString("type", value.Type); writer.WritePropertyName("content"); Content(value.Content).WriteTo(writer); writer.WriteString("subjectId", value.SubjectId);
        if (value.SentAt is { } sent) writer.WriteNumber("sentAt", sent); else writer.WriteNull("sentAt");
        if (value.Omitted is { } omitted) { writer.WriteStartArray("omitted"); foreach (var field in omitted) writer.WriteStringValue(field); writer.WriteEndArray(); }
    });
}
