using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class FleetMapRoutes
{
    public static IReadOnlyList<ApiEndpoint> Endpoints() => [new("fleetMap", Read)];
    private static async ValueTask<Result<ApiReply>> Read(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        async ValueTask<Result<RoomDetails>> Room(string room, string agent, CancellationToken cancellation)
        {
            using var database = new CrossfireDbContext(context.State.Database);
            return await RoomReads.Read(RoomGrantCommands.Ports(database, context.State.Now, context.State.Matrix.Room), context.State.Matrix.Ports(), context.Actor, room, agent, cancellation);
        }
        var ports = new FleetMapPorts(FleetReadQueries.Ports(context.Database, context.State.Now), () => AgentRoutingQueries.Identities(context.Database), ids => FleetMapQueries.Relations(context.Database, ids), Room);
        return Replies.Of((await FleetMaps.Read(ports, context.Actor, parameters["fleetId"], context.Http.RequestAborted)).Map(View));
    }

    private static JsonElement View(FleetMap value) => JsonValues.Object(writer =>
    {
        writer.WritePropertyName("fleet"); FleetReadRoutes.View(writer, value.Fleet); writer.WriteNumber("capturedAt", value.CapturedAt);
        writer.WriteStartArray("sources");
        foreach (var source in value.Sources)
        {
            writer.WriteStartObject(); writer.WriteString("sourceId", source.SourceId); writer.WriteString("mode", source.Mode); writer.WriteStartArray("senders");
            foreach (var sender in source.Senders) { writer.WriteStartObject(); writer.WriteString("principalId", sender.PrincipalId); writer.WriteBoolean("includeAgents", sender.IncludeAgents); writer.WriteEndObject(); }
            writer.WriteEndArray(); JsonValues.Strings(writer, "eligiblePrincipalIds", source.EligiblePrincipalIds); writer.WriteEndObject();
        }
        writer.WriteEndArray(); writer.WritePropertyName("principals"); JsonValues.Array(value.Principals, DiscoveryViews.Principal).WriteTo(writer); writer.WriteStartArray("rooms");
        foreach (var room in value.Rooms) { writer.WriteStartObject(); writer.WriteString("roomId", room.RoomId); writer.WriteString("name", room.Name); writer.WriteString("alias", room.Alias); writer.WriteEndObject(); }
        writer.WriteEndArray(); writer.WriteStartArray("agents");
        foreach (var entry in value.Agents)
        {
            var record = entry.Agent.Record;
            writer.WriteStartObject(); writer.WriteString("agentId", record.Principal.Id); writer.WriteString("matrixUserId", record.Principal.MatrixUserId); writer.WriteString("instanceKey", entry.Agent.Deployment.InstanceKey); writer.WriteString("displayName", record.Name + " (" + record.OwnerMember.DisplayName + ")"); writer.WriteString("status", record.Principal.Status);
            writer.WriteStartObject("owner"); writer.WriteString("memberId", record.Owner.Id); writer.WriteString("matrixUserId", record.Owner.MatrixUserId); writer.WriteString("displayName", record.OwnerMember.DisplayName); writer.WriteString("status", record.Owner.Status); writer.WriteEndObject();
            writer.WriteString("sourceId", entry.SourceId); writer.WriteString("listener", entry.Agent.Activity.Status); JsonValues.Number(writer, "lastSeenAt", entry.Agent.Activity.LastSeenAt); writer.WriteEndObject();
        }
        writer.WriteEndArray(); writer.WriteStartArray("connections");
        foreach (var connection in value.Connections)
        {
            writer.WriteStartObject(); writer.WriteString("agentId", connection.AgentId); writer.WriteString("roomId", connection.RoomId); writer.WritePropertyName("grant"); if (connection.Grant is null) writer.WriteNullValue(); else RoomViews.Grant(writer, connection.Grant);
            writer.WritePropertyName("application"); if (connection.Application is null) writer.WriteNullValue(); else RoomViews.Application(writer, connection.Application); writer.WriteEndObject();
        }
        writer.WriteEndArray();
    });
}
