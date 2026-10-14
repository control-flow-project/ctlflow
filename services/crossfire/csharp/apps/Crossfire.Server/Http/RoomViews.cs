using Crossfire.Kernel;
using System.Text.Json;
using Crossfire.Domain;

namespace Crossfire.Server.Http;

public static class RoomViews
{
    public static void Grant(ProtocolWriter writer, RoomGrant value)
    {
        writer.WriteStartObject(); writer.WriteString("agentId", value.AgentId); writer.WriteString("roomId", value.RoomId); writer.WriteString("generation", value.Generation); writer.WriteString("authorizerId", value.AuthorizerId); writer.WriteString("addedById", value.AddedById);
        writer.WriteString("accessMode", value.AccessMode); JsonValues.Number(writer, "powerLevel", value.PowerLevel); writer.WriteBoolean("muted", value.Muted); writer.WriteNumber("revision", value.Revision); writer.WriteNumber("accessRevision", value.AccessRevision); writer.WriteNumber("updatedAt", value.UpdatedAt); writer.WriteEndObject();
    }

    public static void Application(ProtocolWriter writer, RoomGrantApplication value)
    {
        writer.WriteStartObject(); writer.WriteString("observedGeneration", value.ObservedGeneration); JsonValues.Number(writer, "appliedRevision", value.AppliedRevision); JsonValues.Number(writer, "appliedAccessRevision", value.AppliedAccessRevision);
        writer.WriteString("membership", value.Membership); writer.WriteBoolean("creator", value.Creator); JsonValues.Number(writer, "powerLevel", value.PowerLevel);
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
            writer.WriteStartObject(); writer.WriteString("matrixUserId", facts.MatrixUserId); JsonValues.Number(writer, "powerLevel", facts.PowerLevel); writer.WriteBoolean("creator", facts.Creator); JsonValues.Strings(writer, "creatorIds", facts.CreatorIds);
            writer.WriteNumber("readLevel", facts.ReadLevel); writer.WriteNumber("replyLevel", facts.ReplyLevel); writer.WriteNumber("inviteLevel", facts.InviteLevel); writer.WriteNumber("kickLevel", facts.KickLevel); writer.WriteNumber("changePowerLevel", facts.ChangePowerLevel);
            writer.WritePropertyName("nativePermissions"); JsonValues.Array(facts.NativePermissions, (output, permission) => { output.WriteStartObject(); output.WriteString("action", permission.Action); output.WriteNumber("level", permission.Level); output.WriteEndObject(); }).WriteTo(writer); writer.WriteEndObject();
        }
        writer.WriteEndObject();
    }
}
