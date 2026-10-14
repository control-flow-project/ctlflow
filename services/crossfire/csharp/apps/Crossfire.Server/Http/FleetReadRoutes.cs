using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class FleetReadRoutes
{
    public static IReadOnlyList<ApiEndpoint> Endpoints() =>
    [
        new("fleets", List, ["page", "pageSize", "ownerId", "search"]),
        new("fleet", (context, parameters, input) => Replies.Ready(Replies.Of(FleetReads.Read(FleetReadQueries.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"]).Map(value => JsonValues.Value(writer => View(writer, value)))))),
        new("changeFleet", Change), new("fleetAgents", Agents, ["page", "pageSize"])
    ];

    public static void View(ProtocolWriter writer, FleetDetails value)
    {
        var record = value.Record; writer.WriteStartObject(); writer.WriteString("fleetId", record.Id); writer.WritePropertyName("owner"); DiscoveryViews.Principal(writer, value.Owner);
        writer.WriteString("fleetKey", record.FleetKey); writer.WriteString("label", record.Label); writer.WriteStartObject("controller"); writer.WriteString("name", record.ControllerName);
        writer.WriteStartObject("metadata"); foreach (var entry in value.Metadata) writer.WriteString(entry.Key, entry.Value); writer.WriteEndObject(); writer.WriteEndObject();
        writer.WriteNumber("revision", record.Revision); writer.WriteNumber("createdAt", record.CreatedAt); writer.WriteNumber("updatedAt", record.UpdatedAt);
        writer.WriteStartObject("delivery"); FleetControlViews.Control(writer, new(record.Id, record.Revision, record.DeliveryEnabled, value.Connection)); writer.WriteEndObject();
        writer.WriteBoolean("canArchive", value.CanArchive); JsonValues.Strings(writer, "allowedActions", value.AllowedActions); writer.WriteEndObject();
    }

    private static ValueTask<Result<ApiReply>> List(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var page = Transport.Page(context.Query); if (!page.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(page.Error));
        var owner = context.Query.GetValueOrDefault("ownerId"); var search = context.Query.GetValueOrDefault("search", "");
        if (owner is not null && !Validation.Identifier(owner) || search.Length > 200 || search.Any(character => character is <= '\u001f' or '\u007f')) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid fleet filters"));
        return Replies.Ready(Replies.Paged(FleetReads.List(FleetReadQueries.Ports(context.Database, context.State.Now), context.Actor, page.Value.Page, page.Value.PageSize, owner, search), context.RequestId, View));
    }

    private static ValueTask<Result<ApiReply>> Agents(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var page = Transport.Page(context.Query); if (!page.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(page.Error));
        return Replies.Ready(Replies.Paged(FleetReads.Agents(FleetReadQueries.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"], page.Value.Page, page.Value.PageSize), context.RequestId, (writer, value) =>
        { writer.WriteStartObject(); writer.WriteString("instanceKey", value.Deployment.InstanceKey); writer.WritePropertyName("agent"); AgentViews.Agent(writer, value); writer.WriteEndObject(); }));
    }

    private static ValueTask<Result<ApiReply>> Change(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["expectedRevision", "label", "controller"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var revision = Validation.Integer(input.GetProperty("expectedRevision")); var label = Validation.Text(input.GetProperty("label"), 100); var controller = Inputs.Controller(input.GetProperty("controller"));
        return Replies.Ready(!revision.IsSuccess || !label.IsSuccess || !controller.IsSuccess ? Results.Fail<ApiReply>("invalid", "Invalid fleet configuration")
            : Replies.Of(FleetReads.Change(FleetReadQueries.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"], revision.Value, label.Value, controller.Value, context.RequestId).Map(value => JsonValues.Value(writer => View(writer, value)))));
    }
}
