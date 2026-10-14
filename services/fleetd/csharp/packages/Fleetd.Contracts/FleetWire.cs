using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Kernel;
using Fleetd.Domain;

namespace Fleetd.Contracts;

public static class FleetWire
{
    public static JsonElement Instance(FleetInstance value, bool toml = false) => WireJson.Object(writer =>
    {
        writer.WriteString("key", value.Key); writer.WriteString("name", value.Name); writer.WriteString("definition", value.Definition); writer.WriteString("workarea", value.Workarea); if (value.Workspace is not null) writer.WriteString("workspace", value.Workspace); if (value.RuntimeOptions is { } runtime) { writer.WritePropertyName(toml ? "runtime_options" : "runtimeOptions"); runtime.WriteTo(writer); }
        if (value.HistoryMode != NativeHistoryMode.Shared) { writer.WriteStartObject(toml ? "listener_options" : "listenerOptions"); writer.WriteString(toml ? "history_mode" : "historyMode", "per-room"); writer.WriteEndObject(); }
    });
    public static JsonElement Roster(FleetRoster value) => WireJson.Object(writer => { writer.WriteString("fleet", value.Fleet); writer.WriteStartObject("coordination"); writer.WriteString("adapter", "crossfire"); writer.WriteString("server", value.Coordination.Server); writer.WriteString("owner", value.Coordination.Owner); writer.WriteEndObject(); writer.WriteStartArray("instances"); foreach (var instance in value.Instances) Instance(instance, true).WriteTo(writer); writer.WriteEndArray(); });
    public static JsonElement Controller(ControllerIdentity value) => WireJson.Object(writer => { writer.WriteString("name", value.Name); if (value.Metadata is not null) { writer.WriteStartObject("metadata"); foreach (var pair in value.Metadata) writer.WriteString(pair.Key, pair.Value); writer.WriteEndObject(); } });
    public static JsonElement Registration(FleetRegistration value) => WireJson.Object(writer => { writer.WriteString("fleetId", value.FleetId); writer.WriteString("fleetKey", value.FleetKey); writer.WriteString("directory", value.Directory); writer.WriteString("label", value.Label); writer.WriteNumber("revision", value.Revision); writer.WriteString("digest", value.Digest); });
    public static JsonElement Target(OperationTarget value) => WireJson.Object(writer => { writer.WriteString("kind", value.Kind); if (value.FleetId is not null) writer.WriteString("fleetId", value.FleetId); if (value.InstanceKey is not null) writer.WriteString("instanceKey", value.InstanceKey); });
    public static JsonElement Operation(FleetOperation value) => WireJson.Object(writer =>
    {
        writer.WriteString("operationId", value.Request.OperationId); writer.WritePropertyName("target"); Target(value.Request.Target).WriteTo(writer); writer.WriteString("action", value.Request.Action); writer.WriteNumber("expectedRevision", value.Request.ExpectedRevision); if (value.Request.ReleaseDirectory is not null) writer.WriteString("releaseDirectory", value.Request.ReleaseDirectory); if (value.ReceiptPending) writer.WriteBoolean("receiptPending", true); writer.WriteString("status", value.Status); writer.WriteNumber("createdAt", value.CreatedAt); AgentWire.Number(writer, "completedAt", value.CompletedAt);
        writer.WritePropertyName("approval"); if (value.Approval is { } approval) { writer.WriteStartObject(); writer.WriteString("url", approval.Url); writer.WriteString("code", approval.Code); writer.WriteEndObject(); } else writer.WriteNullValue();
        writer.WriteStartArray("errors"); foreach (var error in value.Errors) { writer.WriteStartObject(); writer.WriteString("instanceKey", error.InstanceKey); writer.WriteString("code", error.Code); writer.WriteString("message", error.Message); writer.WriteEndObject(); } writer.WriteEndArray();
    });
    public static JsonElement InstanceState(InstanceState value) => WireJson.Object(writer => { writer.WritePropertyName("instance"); Instance(value.Instance).WriteTo(writer); writer.WriteString("phase", value.Phase); writer.WriteBoolean("listenerActive", value.ListenerActive); writer.WriteBoolean("desiredActive", value.DesiredActive); AgentWire.Number(writer, "lastActivityAt", value.LastActivityAt); if (value.HistoryAvailable is { } available) writer.WriteBoolean("historyAvailable", available); else writer.WriteNull("historyAvailable"); writer.WriteString("sessionId", value.SessionId); writer.WriteString("error", value.Error); AgentWire.Number(writer, "startedAt", value.StartedAt); });
    public static JsonElement State(FleetState value) => WireJson.Object(writer =>
    {
        var record = value.Registration; writer.WriteString("fleetId", record.FleetId); writer.WriteString("fleetKey", record.FleetKey); writer.WriteString("label", record.Label); writer.WriteString("directory", record.Directory); writer.WriteNumber("revision", record.Revision); writer.WritePropertyName("controller"); Controller(value.Controller).WriteTo(writer); writer.WritePropertyName("resumeInstanceKeys"); if (value.ResumeInstanceKeys is null) writer.WriteNullValue(); else { writer.WriteStartArray(); foreach (var key in value.ResumeInstanceKeys) writer.WriteStringValue(key); writer.WriteEndArray(); } writer.WriteString("phase", value.Phase); writer.WriteStartArray("instances"); foreach (var instance in value.Instances) InstanceState(instance).WriteTo(writer); writer.WriteEndArray(); writer.WriteString("error", value.Error); writer.WriteStartObject("connection"); writer.WriteBoolean("connected", value.Connection.Connected); writer.WriteBoolean("deliveryEnabled", value.Connection.DeliveryEnabled); AgentWire.Number(writer, "revision", value.Connection.Revision); writer.WriteString("error", value.Connection.Error); writer.WriteEndObject();
    });
}
