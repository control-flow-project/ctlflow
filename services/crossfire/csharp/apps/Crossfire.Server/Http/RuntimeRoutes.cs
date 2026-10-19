using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class RuntimeRoutes
{
    private static RuntimePorts Ports(ApiContext context) => RuntimeCommands.Ports(context.Database, context.State.Now, context.State.Messaging, context.State.Configuration.PublicOrigin, context.State.Messaging.ServiceUserId());

    public static IReadOnlyList<ApiEndpoint> Endpoints() =>
    [
        new("runtimeObservations", (context, parameters, input) => Replies.Ready(Replies.Of(RuntimeObservations.Read(Ports(context), context.Actor, parameters["agentId"]).Map(values => JsonValues.Array(values, RuntimeViews.Observation))))),
        new("reportRuntime", Report), new("runtimeDecisions", List, ["page", "pageSize", "status"]), new("createRuntimeDecision", Create),
        new("runtimeDecision", (context, parameters, input) => Replies.Ready(Replies.Of(Decisions.Read(DecisionCommands.Ports(context.Database, context.State.Now), context.Actor, parameters["agentId"], parameters["decisionId"])
            .Map(value => JsonValues.Value(writer => RuntimeViews.Decision(writer, value)))))),
        new("answerRuntimeDecision", Answer),
        new("pollRuntimeDecision", (context, parameters, input) => Replies.Ready(Replies.Of(Decisions.Poll(DecisionCommands.Ports(context.Database, context.State.Now), context.Actor, parameters["agentId"], parameters["decisionId"]).Map(RuntimeViews.Poll)))),
        new("receiptRuntimeDecision", Receipt), new("reportFleetFailure", Failure)
    ];

    private static ValueTask<Result<ApiReply>> Report(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var parsed = RuntimeInputs.Observation(input, parameters["runId"]);
        return Replies.Ready(parsed.IsSuccess ? Replies.Acknowledge(RuntimeObservations.Report(Ports(context), context.Actor, parameters["agentId"], parsed.Value)) : Result<ApiReply>.Fail(parsed.Error));
    }

    private static ValueTask<Result<ApiReply>> List(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var page = Transport.Page(context.Query);
        return Replies.Ready(page.IsSuccess ? Replies.Paged(Decisions.List(DecisionCommands.Ports(context.Database, context.State.Now), context.Actor, parameters["agentId"], page.Value.Page, page.Value.PageSize, context.Query.GetValueOrDefault("status")), context.RequestId, RuntimeViews.DecisionSummary)
            : Result<ApiReply>.Fail(page.Error));
    }

    private static ValueTask<Result<ApiReply>> Create(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var parsed = RuntimeInputs.Decision(input);
        return Replies.Ready(parsed.IsSuccess ? Replies.Of(Decisions.Create(DecisionCommands.Ports(context.Database, context.State.Now), context.Actor, parameters["agentId"], parsed.Value)
            .Map(value => JsonValues.Value(writer => RuntimeViews.Decision(writer, value)))) : Result<ApiReply>.Fail(parsed.Error));
    }

    private static ValueTask<Result<ApiReply>> Answer(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var parsed = RuntimeInputs.Answers(input);
        return Replies.Ready(parsed.IsSuccess ? Replies.Acknowledge(Decisions.Answer(DecisionCommands.Ports(context.Database, context.State.Now), context.Actor, parameters["agentId"], parameters["decisionId"], parsed.Value, context.RequestId)) : Result<ApiReply>.Fail(parsed.Error));
    }

    private static ValueTask<Result<ApiReply>> Receipt(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["status"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var status = Validation.Choice(input.GetProperty("status"), "responded", "cancelled");
        return Replies.Ready(status.IsSuccess ? Replies.Of(Decisions.Receipt(DecisionCommands.Ports(context.Database, context.State.Now), context.Actor, parameters["agentId"], parameters["decisionId"], status.Value)
            .Map(value => JsonValues.Object(writer => writer.WriteBoolean("recorded", value)))) : Result<ApiReply>.Fail(status.Error));
    }

    private static ValueTask<Result<ApiReply>> Failure(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["episodeId", "agentId", "sessionId", "message"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var episode = Inputs.Id(input, "episodeId"); var agent = Inputs.Id(input, "agentId"); var session = Validation.NullableText(input.GetProperty("sessionId")); var message = Validation.PlainText(input.GetProperty("message"), 4000);
        return Replies.Ready(!episode.IsSuccess || !agent.IsSuccess || !session.IsSuccess || !message.IsSuccess ? Results.Fail<ApiReply>("invalid", "Invalid fleet failure report")
            : Replies.Acknowledge(RuntimeIncidents.Report(FleetCommands.Ports(context.Database, context.State.Now), Ports(context).Incidents, context.FleetActor, parameters["fleetId"], episode.Value, agent.Value, session.Value, message.Value)));
    }
}
