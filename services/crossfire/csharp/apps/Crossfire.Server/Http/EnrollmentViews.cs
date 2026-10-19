using Crossfire.Kernel;
using System.Text.Json;
using Crossfire.Domain;

namespace Crossfire.Server.Http;

public static class EnrollmentViews
{
    public static void Overview(ProtocolWriter writer, EnrollmentRequest value, MemberView owner)
    {
        writer.WriteStartObject(); writer.WriteStartObject("owner"); writer.WriteString("principalId", owner.Principal.Id); writer.WriteString("backendUserId", owner.Principal.BackendUserId);
        writer.WriteString("kind", "human"); writer.WriteString("displayName", owner.Member.DisplayName); writer.WriteString("ownerId", owner.Principal.Id);
        writer.WriteString("ownerBackendUserId", owner.Principal.BackendUserId); writer.WriteEndObject(); writer.WriteString("controllerName", value.ControllerName);
        writer.WriteString("enrollmentId", value.Id); writer.WriteString("ownerId", value.OwnerId); writer.WriteString("fleetKey", value.FleetKey);
        writer.WriteString("verificationCode", value.VerificationCode); writer.WriteString("status", value.Status); writer.WriteNumber("revision", value.Revision);
        writer.WriteNumber("createdAt", value.CreatedAt); writer.WriteNumber("expiresAt", value.ExpiresAt); writer.WriteString("decidedByMemberId", value.DecidedByMemberId);
        JsonValues.Number(writer, "decidedAt", value.DecidedAt); writer.WriteEndObject();
    }

    public static void Review(ProtocolWriter writer, EnrollmentReview value)
    {
        writer.WriteStartObject(); writer.WritePropertyName("enrollment"); Overview(writer, value.Request, value.Owner);
        writer.WriteStartArray("instances");
        foreach (var item in value.Instances)
        {
            writer.WriteStartObject(); writer.WriteString("instanceKey", item.Item.InstanceKey); writer.WriteString("requestedName", item.Item.RequestedName);
            writer.WriteString("currentName", item.CurrentName); writer.WriteString("outcome", item.Item.Outcome); writer.WriteString("agentId", item.Item.AgentId);
            writer.WriteStartObject("coordinationPolicy"); writer.WriteString("wakeMode", item.CoordinationPolicy.WakeMode); writer.WriteStartArray("senders");
            foreach (var sender in item.CoordinationPolicy.Senders)
            {
                writer.WriteStartObject(); writer.WriteString("backendUserId", sender.BackendUserId); writer.WriteBoolean("includeAgents", sender.IncludeAgents); writer.WriteEndObject();
            }
            writer.WriteEndArray(); JsonValues.Strings(writer, "permissions", item.CoordinationPolicy.Permissions); writer.WriteEndObject(); writer.WriteEndObject();
        }
        writer.WriteEndArray(); writer.WriteEndObject();
    }

    public static JsonElement Exchange(EnrollmentExchange value) => JsonValues.Object(writer =>
    {
        writer.WriteString("status", value.Status); writer.WriteString("ownerBackendUserId", value.OwnerBackendUserId);
        if (value.Fleet is null) writer.WriteNull("fleet");
        else
        {
            writer.WriteStartObject("fleet"); writer.WriteString("fleetId", value.Fleet.FleetId); writer.WriteString("controllerCredential", value.Fleet.ControllerCredential); writer.WriteEndObject();
        }
        writer.WriteStartArray("instances");
        foreach (var item in value.Instances)
        {
            writer.WriteStartObject(); writer.WriteString("instanceKey", item.InstanceKey); writer.WriteString("name", item.Name); writer.WriteString("agentId", item.AgentId);
            writer.WriteString("status", item.Status); writer.WriteString("errorCode", item.ErrorCode);
            if (item.Account is null) writer.WriteNull("account");
            else
            {
                writer.WritePropertyName("account"); Crossfire.Contracts.MessagingContract.Account(item.Account).WriteTo(writer);
            }
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    });
}
