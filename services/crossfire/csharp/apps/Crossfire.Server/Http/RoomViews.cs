using Crossfire.Kernel;
using System.Text.Json;
using Crossfire.Domain;

namespace Crossfire.Server.Http;

public static class RoomViews
{
    public static void Grant(ProtocolWriter writer, RoomGrant value)
    {
        writer.WriteStartObject(); writer.WriteString("agentId", value.AgentId); writer.WriteString("roomId", value.RoomId); writer.WriteString("generation", value.Generation); writer.WriteString("authorizerId", value.AuthorizerId); writer.WriteString("addedById", value.AddedById);
        writer.WriteString("accessMode", value.AccessMode); NativeAccess(writer, value.NativeAccess); writer.WriteBoolean("muted", value.Muted); writer.WriteNumber("revision", value.Revision); writer.WriteNumber("accessRevision", value.AccessRevision); writer.WriteNumber("updatedAt", value.UpdatedAt); writer.WriteEndObject();
    }

    public static void Application(ProtocolWriter writer, RoomGrantApplication value)
    {
        writer.WriteStartObject(); writer.WriteString("observedGeneration", value.ObservedGeneration); JsonValues.Number(writer, "appliedRevision", value.AppliedRevision); JsonValues.Number(writer, "appliedAccessRevision", value.AppliedAccessRevision);
        writer.WriteString("membership", value.Membership); NativeAccess(writer, value.NativeAccess);
        JsonValues.Number(writer, "lastAttemptAt", value.LastAttemptAt); JsonValues.Number(writer, "lastSuccessAt", value.LastSuccessAt); writer.WriteString("errorCode", value.ErrorCode); writer.WriteString("errorMessage", value.ErrorMessage); writer.WriteEndObject();
    }

    public static void View(ProtocolWriter writer, GrantView value)
    {
        writer.WriteStartObject(); writer.WriteString("agentId", value.AgentId); writer.WriteNumber("revision", value.Revision); writer.WriteBoolean("ownerConversation", value.OwnerConversation);
        writer.WritePropertyName("grant"); if (value.Grant is null) writer.WriteNullValue(); else Grant(writer, value.Grant);
        writer.WritePropertyName("application"); if (value.Application is null) writer.WriteNullValue(); else Application(writer, value.Application);
        JsonValues.Strings(writer, "permissions", value.Permissions); JsonValues.Strings(writer, "allowedActions", value.AllowedActions); writer.WriteEndObject();
    }

    public static void Room(ProtocolWriter writer, RoomDetails value)
    {
        writer.WriteStartObject(); writer.WriteString("roomId", value.RoomId); writer.WriteString("name", value.Name); writer.WriteString("topic", value.Topic); writer.WriteString("alias", value.Alias);
        writer.WritePropertyName("authority");
        if (value.Authority is not { } facts) writer.WriteNullValue();
        else
        {
            writer.WriteStartObject(); MessagingJson.WriteAuthority(writer, facts); writer.WriteEndObject();
        }
        writer.WriteEndObject();
    }
    public static void NativeAccess(ProtocolWriter writer, JsonElement? value)
    { writer.WritePropertyName("nativeAccess"); if (value is { } native) native.WriteTo(writer); else writer.WriteNullValue(); }
}
