using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class AgentRoutes
{
    private static AgentRoutingPorts Routing(ApiContext context) => AgentRoutingQueries.Ports(context.Database, context.State.Now, context.State.Messaging);
    public static IReadOnlyList<ApiEndpoint> Endpoints() =>
    [
        new("agents", List, ["page", "pageSize", "ownerId", "status", "listener", "search"]),
        new("agent", (context, parameters, input) => Replies.Ready(Read(context, parameters["agentId"]))), new("changeAgent", Change),
        new("wakePolicy", (context, parameters, input) => Replies.Ready(Replies.Of(AgentRouting.Wake(Routing(context), context.Actor, parameters["agentId"]).Map(AgentViews.Wake)))),
        new("changeWakePolicy", Wake),
        new("deliveryPolicy", (context, parameters, input) => Replies.Ready(Replies.Of(AgentRouting.Delivery(Routing(context), context.Actor, parameters["agentId"]).Map(AgentViews.Delivery))))
    ];

    private static Result<ApiReply> Read(ApiContext context, string agentId)
        => Replies.Of(AgentReads.Read(AgentReadQueries.Ports(context.Database, context.State.Now), context.Actor, agentId).Map(value => JsonValues.Value(writer => AgentViews.Agent(writer, value))));

    private static ValueTask<Result<ApiReply>> List(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var page = Transport.Page(context.Query); if (!page.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(page.Error));
        var owner = context.Query.GetValueOrDefault("ownerId"); var search = context.Query.GetValueOrDefault("search", ""); var listener = context.Query.GetValueOrDefault("listener", "all");
        var source = context.Query.GetValueOrDefault("status", "active,suspended"); var statuses = source.Length == 0 ? [] : source.Split(',');
        if (owner is not null && !Validation.Identifier(owner) || search.Length > 200 || search.Any(value => value is <= '\u001f' or '\u007f')
            || listener is not ("all" or "online" or "offline" or "disconnecting") || statuses.Any(value => value is not ("active" or "suspended" or "revoked")) || statuses.Distinct(StringComparer.Ordinal).Count() != statuses.Length)
            return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid agent directory filters"));
        return Replies.Ready(Replies.Paged(AgentReads.List(AgentReadQueries.Ports(context.Database, context.State.Now), context.Actor, new(page.Value.Page, page.Value.PageSize, owner, statuses, search, listener)), context.RequestId, AgentViews.Agent));
    }

    private static ValueTask<Result<ApiReply>> Change(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["expectedRevision"], ["status"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var revision = Validation.Integer(input.GetProperty("expectedRevision"));
        var status = input.TryGetProperty("status", out var choice) ? Validation.Choice(choice, "active", "suspended", "revoked").Map<string?>(value => value) : Result<string?>.Success(null);
        if (!revision.IsSuccess || !status.IsSuccess) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid account change"));
        var changed = Agents.Change(AgentCommands.Ports(context.Database, context.State.Now), context.Actor, parameters["agentId"], new(revision.Value, status.Value), context.RequestId);
        return Replies.Ready(changed.IsSuccess ? Read(context, parameters["agentId"]) : Result<ApiReply>.Fail(changed.Error));
    }

    private static ValueTask<Result<ApiReply>> Wake(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["expectedRevision", "mode", "senders"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var revision = Validation.Integer(input.GetProperty("expectedRevision")); var mode = Validation.Choice(input.GetProperty("mode"), "humans", "everyone", "selected");
        var senders = Validation.List(input.GetProperty("senders"), value =>
        {
            var selection = Validation.Fields(value, ["principalId", "includeAgents"]); if (!selection.IsSuccess) return Result<WakeSelection>.Fail(selection.Error);
            var id = Inputs.Id(value, "principalId"); var include = Validation.Boolean(value.GetProperty("includeAgents"));
            return !id.IsSuccess || !include.IsSuccess ? Results.Fail<WakeSelection>("invalid", "Invalid selected wake authority") : Result<WakeSelection>.Success(new(id.Value, include.Value));
        }, 2000);
        if (!revision.IsSuccess || !mode.IsSuccess || !senders.IsSuccess) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid wake authority"));
        var changed = WakeChanges.Change(WakeCommands.Ports(context.Database, context.State.Now), context.Actor, parameters["agentId"], new(revision.Value, mode.Value, senders.Value), context.RequestId);
        return Replies.Ready(changed.IsSuccess ? Replies.Of(AgentRouting.Wake(Routing(context), context.Actor, parameters["agentId"]).Map(AgentViews.Wake)) : Result<ApiReply>.Fail(changed.Error));
    }
}
