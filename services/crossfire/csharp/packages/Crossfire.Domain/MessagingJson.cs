using System.Text.Json;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class MessagingJson
{
    public static JsonElement Description(BackendDescription value) => WireJson.Object(writer =>
    {
        writer.WriteString("type", value.Type); writer.WriteString("label", value.Label); writer.WriteString("chatUrl", value.ChatUrl); writer.WriteString("signupUrl", value.SignupUrl);
        WireJson.Strings(writer, "signupInstructions", value.SignupInstructions); writer.WriteStartObject("configuration"); writer.WriteString("type", value.Configuration.Type);
        writer.WritePropertyName("parameters"); value.Configuration.Parameters.WriteTo(writer); writer.WriteEndObject();
    });
    public static JsonElement Facts(RoomFacts value) => WireJson.Object(writer =>
    {
        writer.WriteString("roomId", value.RoomId); writer.WriteString("name", value.Name); writer.WriteString("topic", value.Topic);
        writer.WriteString("alias", value.Alias); WriteAuthority(writer, value);
    });
    public static void WriteAuthority(ProtocolWriter writer, RoomFacts value)
    {
        writer.WriteString("backendUserId", value.BackendUserId); writer.WriteBoolean("canInvite", value.CanInvite);
        writer.WriteString("authorityRevision", value.AuthorityRevision); writer.WriteStartArray("accessModes");
        foreach (var mode in value.AccessModes) writer.WriteStringValue(mode); writer.WriteEndArray();
        writer.WriteStartArray("accessFields"); foreach (var field in value.AccessFields)
        {
            writer.WriteStartObject(); writer.WriteString("key", field.Key); writer.WriteString("label", field.Label); writer.WriteNumber("minimum", field.Minimum);
            writer.WriteNumber("maximum", field.Maximum); writer.WriteNumber("defaultValue", field.DefaultValue); writer.WriteEndObject();
        }
        writer.WriteEndArray(); writer.WriteStartArray("permissions"); foreach (var permission in value.Permissions)
        {
            writer.WriteStartObject(); writer.WriteString("action", permission.Action); writer.WriteString("label", permission.Label); writer.WriteBoolean("allowed", permission.Allowed); writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }
}
