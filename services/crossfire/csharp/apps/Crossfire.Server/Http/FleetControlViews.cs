using Crossfire.Kernel;
using System.Text.Json;
using Crossfire.Domain;

namespace Crossfire.Server.Http;

public static class FleetControlViews
{
    public static void Control(ProtocolWriter writer, FleetControlView value)
    {
        writer.WriteString("fleetId", value.FleetId); writer.WriteNumber("revision", value.Revision); writer.WriteBoolean("deliveryEnabled", value.DeliveryEnabled);
        writer.WriteStartObject("connection"); writer.WriteString("status", value.Connection.Status); JsonValues.Number(writer, "lastSeenAt", value.Connection.LastSeenAt); writer.WriteEndObject();
    }

    public static void Operation(ProtocolWriter writer, FleetOperationView value)
    {
        writer.WriteStartObject(); writer.WriteString("operationId", value.OperationId); writer.WriteString("fleetId", value.FleetId); writer.WriteString("agentId", value.AgentId);
        writer.WriteString("action", value.Action); writer.WriteNumber("expectedRevision", value.ExpectedRevision); writer.WriteString("status", value.Status);
        writer.WriteNumber("createdAt", value.CreatedAt); JsonValues.Number(writer, "completedAt", value.CompletedAt); writer.WriteString("errorMessage", value.ErrorMessage); writer.WriteEndObject();
    }

    public static void Message(ProtocolWriter writer, FleetMessageSummary value)
    {
        writer.WriteStartObject(); writer.WriteString("messageId", value.MessageId); writer.WriteString("body", value.Body); writer.WriteNumber("createdAt", value.CreatedAt); writer.WriteNumber("expiresAt", value.ExpiresAt);
        writer.WriteNumber("total", value.Total); writer.WriteNumber("delivered", value.Delivered); writer.WriteNumber("failed", value.Failed); writer.WriteNumber("skipped", value.Skipped);
        writer.WriteNumber("pending", value.Pending); writer.WriteNumber("expired", value.Expired); writer.WriteEndObject();
    }

    public static JsonElement Snapshot(FleetControlSnapshot value) => JsonValues.Object(writer =>
    {
        Control(writer, value.Control); JsonValues.Strings(writer, "agentIds", value.AgentIds);
        writer.WritePropertyName("runtimeOperations"); JsonValues.Array(value.RuntimeOperations, Operation).WriteTo(writer);
        writer.WritePropertyName("messages"); JsonValues.Array(value.Messages, (output, message) =>
        {
            output.WriteStartObject(); output.WriteString("messageId", message.MessageId); output.WriteString("fleetId", message.FleetId); output.WriteString("body", message.Body);
            output.WriteNumber("createdAt", message.CreatedAt); output.WriteNumber("expiresAt", message.ExpiresAt);
            output.WriteStartObject("sender"); output.WriteString("kind", message.Sender.Kind); output.WriteString("matrixUserId", message.Sender.MatrixUserId); output.WriteEndObject();
            JsonValues.Strings(output, "agentIds", message.AgentIds); output.WriteEndObject();
        }).WriteTo(writer);
    });
}
