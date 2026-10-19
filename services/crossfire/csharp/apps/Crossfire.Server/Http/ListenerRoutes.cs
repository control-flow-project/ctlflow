using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class ListenerRoutes
{
    public static IReadOnlyList<ApiEndpoint> Endpoints() => [new("listenerRuns", Runs, ["page", "pageSize"]), new("reportListener", Report), new("fleetStatistics", Statistics, ["hours", "page", "pageSize"])];

    public static void Run(ProtocolWriter writer, ListenerRun value)
    {
        writer.WriteStartObject(); writer.WriteString("runId", value.Id); writer.WriteString("agentId", value.AgentId); writer.WriteString("release", value.Release);
        writer.WriteStartObject("controller"); writer.WriteString("fleetId", value.Controller.FleetId); writer.WriteString("connectionId", value.Controller.ConnectionId); writer.WriteString("credentialId", value.Controller.CredentialId); writer.WriteEndObject();
        writer.WriteNumber("startedAt", value.StartedAt); writer.WriteNumber("lastSeenAt", value.LastSeenAt); writer.WriteNumber("activeMs", value.ActiveMs); writer.WriteNumber("messagesDelivered", value.MessagesDelivered);
        JsonValues.Number(writer, "stoppedAt", value.StoppedAt); JsonValues.Number(writer, "disconnectRequestedAt", value.DisconnectRequestedAt); writer.WriteEndObject();
    }

    private static ValueTask<Result<ApiReply>> Runs(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var page = Transport.Page(context.Query); if (!page.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(page.Error));
        var authority = Authorization.Agent(context.Authorization, context.Actor, parameters["agentId"], "read");
        return Replies.Ready(authority.IsSuccess ? Replies.Paged(ListenerQueries.History(context.Database, parameters["agentId"], page.Value.Page, page.Value.PageSize), context.RequestId, Run) : Result<ApiReply>.Fail(authority.Error));
    }

    private static ValueTask<Result<ApiReply>> Report(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["release", "messagesDelivered", "stopped", "controller", "statistics"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var release = Validation.Text(input.GetProperty("release"), 200); var messages = Validation.Integer(input.GetProperty("messagesDelivered")); var stopped = Validation.Boolean(input.GetProperty("stopped"));
        var controller = input.GetProperty("controller"); var properties = Validation.Fields(controller, ["fleetId", "connectionId", "credential"]); if (!properties.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(properties.Error));
        var fleet = Inputs.Id(controller, "fleetId"); var connection = Inputs.Id(controller, "connectionId"); var credential = Validation.Text(controller.GetProperty("credential"), 200);
        var statistics = input.GetProperty("statistics").ValueKind == JsonValueKind.Null ? Result<StatisticsBatch?>.Success(null) : StatisticsInputs.Batch(input.GetProperty("statistics")).Map<StatisticsBatch?>(value => value);
        if (!release.IsSuccess || !messages.IsSuccess || !stopped.IsSuccess || !fleet.IsSuccess || !connection.IsSuccess || !credential.IsSuccess || !statistics.IsSuccess)
            return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid listener report"));
        var result = ListenerReporting.Report(ListenerCommands.Ports(context.Database, context.State.Now), context.Actor, parameters["agentId"], parameters["runId"], new(release.Value, messages.Value, stopped.Value,
            new(fleet.Value, connection.Value, credential.Value)), context.State.Release.Identity);
        if (!result.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(result.Error));
        var recorded = !result.Value.Closed && (statistics.Value is null || StatisticsCommands.Record(context.Database, parameters["agentId"], parameters["runId"], statistics.Value, context.State.Now()).IsSuccess);
        return Replies.Ready(Result<ApiReply>.Success(new(JsonValues.Object(writer => { writer.WriteBoolean("disconnect", result.Value.Disconnect); writer.WriteString("currentRelease", result.Value.CurrentRelease); writer.WriteBoolean("statisticsAccepted", recorded); }))));
    }

    private static ValueTask<Result<ApiReply>> Statistics(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var values = new[] { context.Query.GetValueOrDefault("hours", "24"), context.Query.GetValueOrDefault("page", "1"), context.Query.GetValueOrDefault("pageSize", "20") };
        if (values.Any(value => !int.TryParse(value, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var number) || number < 1 || number.ToString(System.Globalization.CultureInfo.InvariantCulture) != value))
            return Replies.Ready(Results.Fail<ApiReply>("invalid", "Statistics query values must be canonical positive integers"));
        return Replies.Ready(Replies.Of(FleetStatistics.Read(FleetCommands.Ports(context.Database, context.State.Now), DiscoveryQueries.Ports(context.Database, context.State.Now), StatisticsQueries.Ports(context.Database),
            context.FleetActor, parameters["fleetId"], int.Parse(values[0], System.Globalization.CultureInfo.InvariantCulture), int.Parse(values[1], System.Globalization.CultureInfo.InvariantCulture), int.Parse(values[2], System.Globalization.CultureInfo.InvariantCulture), context.State.Configuration.LoggingRetentionDays).Map(StatisticsViews.Fleet)));
    }
}
