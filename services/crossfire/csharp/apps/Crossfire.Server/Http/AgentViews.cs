using Crossfire.Kernel;
using System.Text.Json;
using Crossfire.Domain;

namespace Crossfire.Server.Http;

public static class AgentViews
{
    public static void Owner(ProtocolWriter writer, AgentView value)
    {
        writer.WriteStartObject("owner"); writer.WriteString("memberId", value.Owner.Id); writer.WriteString("backendUserId", value.Owner.BackendUserId); writer.WriteString("displayName", value.OwnerMember.DisplayName); writer.WriteString("status", value.Owner.Status); writer.WriteEndObject();
    }

    public static void Activity(ProtocolWriter writer, ListenerActivity value)
    {
        writer.WriteStartObject("activity"); writer.WriteString("status", value.Status); writer.WriteNumber("activeMs", value.ActiveMs); writer.WriteNumber("messagesDelivered", value.MessagesDelivered); JsonValues.Number(writer, "lastSeenAt", value.LastSeenAt);
        writer.WritePropertyName("activeRuns"); JsonValues.Array(value.ActiveRuns, ListenerRoutes.Run).WriteTo(writer); writer.WriteEndObject();
    }

    public static void Agent(ProtocolWriter writer, AgentDetails value)
    {
        var record = value.Record; writer.WriteStartObject(); writer.WriteString("agentId", record.Principal.Id); writer.WriteString("backendUserId", record.Principal.BackendUserId); writer.WriteString("name", record.Name);
        writer.WriteString("displayName", record.Name + " (" + record.OwnerMember.DisplayName + ")"); Owner(writer, record);
        writer.WriteString("status", record.Principal.Status); writer.WriteNumber("revision", record.Principal.Revision); writer.WriteNumber("createdAt", record.Principal.CreatedAt);
        JsonValues.Application(writer, record.Application); Activity(writer, value.Activity); writer.WritePropertyName("nativeRuntime"); RuntimeViews.Summary(writer, value.NativeRuntime);
        writer.WriteStartObject("deployment"); writer.WriteString("fleetId", value.Deployment.FleetId); writer.WriteString("fleetKey", value.Deployment.FleetKey); writer.WriteString("label", value.Deployment.Label);
        writer.WriteString("controllerName", value.Deployment.ControllerName); writer.WriteNumber("reportedAt", value.Deployment.ReportedAt); writer.WriteString("instanceKey", value.Deployment.InstanceKey); writer.WriteEndObject();
        writer.WriteBoolean("canRetire", value.CanRetire); JsonValues.Strings(writer, "allowedActions", value.AllowedActions); writer.WriteEndObject();
    }

    public static JsonElement Wake(WakePolicyView value) => JsonValues.Object(writer =>
    {
        writer.WriteString("agentId", value.AgentId); writer.WriteNumber("revision", value.Revision); writer.WriteString("mode", value.Mode); writer.WritePropertyName("senders"); JsonValues.Array(value.Senders, (output, sender) =>
        { output.WriteStartObject(); output.WritePropertyName("identity"); DiscoveryViews.Principal(output, sender.Identity); output.WriteBoolean("includeAgents", sender.IncludeAgents); output.WriteEndObject(); }).WriteTo(writer);
    });

    public static JsonElement Delivery(AgentDeliveryPolicy value) => JsonValues.Object(writer =>
    {
        writer.WriteString("agentId", value.Record.Principal.Id); writer.WriteString("backendUserId", value.Record.Principal.BackendUserId); writer.WriteString("ownerBackendUserId", value.Record.Owner.BackendUserId);
        writer.WriteString("status", value.Record.Principal.Status); writer.WriteString("ownerStatus", value.Record.Owner.Status); writer.WriteString("ownerConversation", value.OwnerConversation);
        writer.WriteString("wakeMode", value.Record.Agent.WakeMode); JsonValues.Strings(writer, "senderBackendUserIds", value.Senders); writer.WriteNumber("maxMessageBytes", value.MaxMessageBytes); writer.WriteNumber("fleetIdleTimeoutSeconds", value.FleetIdleTimeoutSeconds);
        writer.WritePropertyName("roomGrants"); JsonValues.Array(value.Grants, (output, grant) =>
        { output.WriteStartObject(); output.WriteString("roomId", grant.RoomId); output.WriteString("accessMode", grant.AccessMode); RoomViews.NativeAccess(output, grant.NativeAccess); output.WriteBoolean("muted", grant.Muted); output.WriteEndObject(); }).WriteTo(writer);
    });
}
