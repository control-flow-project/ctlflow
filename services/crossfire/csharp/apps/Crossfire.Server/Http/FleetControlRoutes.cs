using System.Globalization;
using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class FleetControlRoutes
{
    public static IReadOnlyList<ApiEndpoint> Endpoints() =>
    [
        new("changeFleetDelivery", Delivery), new("reportFleetConnection", Connection), new("fleetControl", Control, ["connectionId", "revision", "waitMs"]),
        new("fleetMessages", Messages, ["page", "pageSize"]), new("createFleetMessage", CreateMessage), new("acknowledgeFleetMessage", MessageReceipt),
        new("fleetRuntimeOperations", Operations, ["page", "pageSize"]), new("requestFleetRuntime", Request), new("claimFleetRuntime", Claim), new("receiptFleetRuntime", Receipt),
        new("recordFleetNativeStop", NativeStop), new("removeFleetAgent", Remove), new("archiveFleet", Archive)
    ];

    private static ValueTask<Result<ApiReply>> Delivery(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["expectedRevision", "enabled"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var revision = Validation.Integer(input.GetProperty("expectedRevision")); var enabled = Validation.Boolean(input.GetProperty("enabled"));
        return Replies.Ready(!revision.IsSuccess || !enabled.IsSuccess ? Results.Fail<ApiReply>("invalid", "Invalid delivery change")
            : Replies.Of(FleetControl.Delivery(FleetCommands.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"], revision.Value, enabled.Value, context.RequestId)
                .Map(value => JsonValues.Object(writer => FleetControlViews.Control(writer, value)))));
    }

    private static ValueTask<Result<ApiReply>> Connection(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["stopped"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var stopped = Validation.Boolean(input.GetProperty("stopped"));
        return Replies.Ready(stopped.IsSuccess ? Replies.Of(FleetControl.ReportConnection(FleetCommands.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"], parameters["connectionId"], stopped.Value)
            .Map(value => JsonValues.Object(writer => FleetControlViews.Control(writer, value)))) : Result<ApiReply>.Fail(stopped.Error));
    }

    private static bool QueryNumber(string? value, long minimum, long maximum, out long number)
        => long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out number) && number >= minimum && number <= maximum && number.ToString(CultureInfo.InvariantCulture) == value;

    private static async ValueTask<Result<ApiReply>> Control(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var connection = context.Query.GetValueOrDefault("connectionId");
        if (connection is null || !Validation.Identifier(connection) || !QueryNumber(context.Query.GetValueOrDefault("revision"), 0, Validation.MaxWireInteger, out var revision)
            || !QueryNumber(context.Query.GetValueOrDefault("waitMs"), 0, 10000, out var wait)) return Results.Fail<ApiReply>("invalid", "A connectionId, revision and bounded waitMs are required");
        var fleetId = parameters["fleetId"]; var version = context.Changes.Version(fleetId); var ports = FleetMessageCommands.Ports(context.Database, context.State.Now);
        var current = FleetMessages.Control(ports, context.FleetActor, fleetId, connection);
        if (!current.IsSuccess || current.Value.Control.Revision != revision || current.Value.Messages.Count != 0 || current.Value.RuntimeOperations.Count != 0)
            return Replies.Of(current.Map(FleetControlViews.Snapshot));
        var waited = await context.Changes.Wait(fleetId, version, (int)wait, context.Http.RequestAborted);
        return waited.IsSuccess ? Replies.Of(FleetMessages.Control(ports, context.FleetActor, fleetId, connection).Map(FleetControlViews.Snapshot)) : Result<ApiReply>.Fail(waited.Error);
    }

    private static ValueTask<Result<ApiReply>> Messages(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        if (!QueryNumber(context.Query.GetValueOrDefault("page", "1"), 1, 100000, out var page) || !QueryNumber(context.Query.GetValueOrDefault("pageSize", "10"), 1, 10, out var size))
            return Replies.Ready(Results.Fail<ApiReply>("invalid", "Use canonical message page numbers and a pageSize of 1–10"));
        return Replies.Ready(Replies.Paged(FleetMessages.List(FleetMessageCommands.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"], (int)page, (int)size), context.RequestId, FleetControlViews.Message));
    }

    private static ValueTask<Result<ApiReply>> CreateMessage(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["messageId", "body"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var id = Inputs.Id(input, "messageId"); var body = Validation.PlainText(input.GetProperty("body"), FleetMessageValues.MaxBytes);
        return Replies.Ready(!id.IsSuccess || !body.IsSuccess ? Results.Fail<ApiReply>("invalid", "Invalid bounded fleet message")
            : Replies.Of(FleetMessages.Create(FleetMessageCommands.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"], id.Value, body.Value, context.RequestId)
                .Map(value => JsonValues.Value(writer => FleetControlViews.Message(writer, value)))));
    }

    private static ValueTask<Result<ApiReply>> MessageReceipt(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["status", "errorMessage"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var status = Validation.Choice(input.GetProperty("status"), "delivered", "failed", "skipped"); var error = Validation.NullableText(input.GetProperty("errorMessage"), 1000);
        return Replies.Ready(!status.IsSuccess || !error.IsSuccess ? Results.Fail<ApiReply>("invalid", "Invalid delivery receipt")
            : Replies.Of(FleetMessages.Receipt(FleetMessageCommands.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"], parameters["messageId"], parameters["agentId"], status.Value, error.Value)
                .Map(recorded => JsonValues.Object(writer => writer.WriteBoolean("recorded", recorded)))));
    }

    private static ValueTask<Result<ApiReply>> Operations(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var page = Transport.Page(context.Query);
        return Replies.Ready(page.IsSuccess ? Replies.Paged(FleetOperations.List(FleetCommands.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"], page.Value.Page, page.Value.PageSize), context.RequestId, FleetControlViews.Operation)
            : Result<ApiReply>.Fail(page.Error));
    }

    private static ValueTask<Result<ApiReply>> Request(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["operationId", "agentId", "action", "expectedRevision", "confirmFreshHistory"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var id = Inputs.Id(input, "operationId"); var agent = Validation.NullableText(input.GetProperty("agentId")); var action = Validation.Choice(input.GetProperty("action"), "start", "stop", "reset");
        var revision = Validation.Integer(input.GetProperty("expectedRevision")); var confirmed = Validation.Boolean(input.GetProperty("confirmFreshHistory"));
        return Replies.Ready(!id.IsSuccess || !agent.IsSuccess || agent.Value is not null && !Validation.Identifier(agent.Value) || !action.IsSuccess || !revision.IsSuccess || !confirmed.IsSuccess
            ? Results.Fail<ApiReply>("invalid", "Invalid native session request") : Replies.Of(FleetOperations.Request(FleetCommands.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"],
                new(id.Value, agent.Value, action.Value, revision.Value, confirmed.Value), context.RequestId).Map(value => JsonValues.Value(writer => FleetControlViews.Operation(writer, value)))));
    }

    private static ValueTask<Result<ApiReply>> Claim(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["connectionId"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var connection = Inputs.Id(input, "connectionId");
        return Replies.Ready(connection.IsSuccess ? Replies.Of(FleetOperations.Claim(FleetCommands.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"], parameters["operationId"], connection.Value)
            .Map(value => JsonValues.Value(writer => FleetControlViews.Operation(writer, value)))) : Result<ApiReply>.Fail(connection.Error));
    }

    private static ValueTask<Result<ApiReply>> Receipt(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["connectionId", "status", "errorMessage"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var connection = Inputs.Id(input, "connectionId"); var status = Validation.Choice(input.GetProperty("status"), "succeeded", "failed"); var error = Validation.NullableText(input.GetProperty("errorMessage"), 4096);
        return Replies.Ready(!connection.IsSuccess || !status.IsSuccess || !error.IsSuccess ? Results.Fail<ApiReply>("invalid", "Invalid native session receipt")
            : Replies.Of(FleetOperations.Receipt(FleetCommands.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"], parameters["operationId"], new(connection.Value, status.Value, error.Value))
                .Map(recorded => JsonValues.Object(writer => writer.WriteBoolean("recorded", recorded)))));
    }

    private static ValueTask<Result<ApiReply>> NativeStop(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["connectionId", "runId", "receiptId"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var connection = Inputs.Id(input, "connectionId"); var run = Inputs.Id(input, "runId"); var receipt = Inputs.Id(input, "receiptId");
        if (!connection.IsSuccess || !run.IsSuccess || !receipt.IsSuccess) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid native stop receipt"));
        return Replies.Ready(Replies.Of(FleetRetirement.RecordStop(RetirementCommands.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"], parameters["agentId"], connection.Value, run.Value, receipt.Value)
            .Map(_ => JsonValues.Recorded())));
    }

    private static ValueTask<Result<ApiReply>> Remove(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["expectedRevision", "instanceKey"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var revision = Validation.Integer(input.GetProperty("expectedRevision")); var key = Inputs.Name(input, "instanceKey");
        return Replies.Ready(!revision.IsSuccess || !key.IsSuccess ? Results.Fail<ApiReply>("invalid", "Invalid instance retirement")
            : Replies.Acknowledge(FleetRetirement.Remove(RetirementCommands.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"], parameters["agentId"], key.Value, revision.Value, context.RequestId)));
    }

    private static ValueTask<Result<ApiReply>> Archive(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["expectedRevision"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var revision = Validation.Integer(input.GetProperty("expectedRevision"));
        return Replies.Ready(revision.IsSuccess ? Replies.Acknowledge(FleetRetirement.Archive(RetirementCommands.Ports(context.Database, context.State.Now), context.FleetActor, parameters["fleetId"], revision.Value, context.RequestId)) : Result<ApiReply>.Fail(revision.Error));
    }
}
