using System.Text.Json;
using Crossfire.AdapterSchedule;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class WakeRoutes
{
    private static WakeRulePorts Rules(ApiContext context) => WakeRuleCommands.Rules(context.Database, context.State.Now, CalendarSchedule.Next);
    private static WakeDeliveryPorts Deliveries(ApiContext context) => WakeRuleCommands.Deliveries(context.Database, context.State.Now, CalendarSchedule.Next);
    public static IReadOnlyList<ApiEndpoint> Endpoints() =>
    [
        new("wakeRules", List, ["page", "pageSize", "search", "ownerId"]), new("createWakeRule", (context, parameters, input) => Save(context, parameters, input, true)),
        new("wakeRule", (context, parameters, input) => Replies.Ready(Replies.Of(WakeRules.Read(Rules(context), context.Actor, parameters["ruleId"]).Map(Details)))),
        new("changeWakeRule", (context, parameters, input) => Save(context, parameters, input, false)), new("deleteWakeRule", Delete),
        new("wakeMetadata", (context, parameters, input) => Delivery(context, parameters, input, "metadata"), ["runId", "sessionId"]),
        new("claimWake", (context, parameters, input) => Delivery(context, parameters, input, "claim")),
        new("validateWake", (context, parameters, input) => Delivery(context, parameters, input, "validate"), ["runId", "sessionId"]),
        new("acknowledgeWake", (context, parameters, input) => Delivery(context, parameters, input, "receipt"))
    ];

    private static Result<WakeSchedule> Schedule(JsonElement input)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty("kind", out var kind)) return Results.Fail<WakeSchedule>("invalid", "Choose an interval or calendar schedule");
        var selected = Validation.Choice(kind, "interval", "cron"); if (!selected.IsSuccess) return Result<WakeSchedule>.Fail(selected.Error);
        var fields = Validation.Fields(input, selected.Value == "interval" ? ["kind", "seconds"] : ["kind", "expression", "timeZone"]); if (!fields.IsSuccess) return Result<WakeSchedule>.Fail(fields.Error);
        if (selected.Value == "interval") return Validation.Integer(input.GetProperty("seconds"), 1, 31536000).Map<WakeSchedule>(seconds => new IntervalSchedule(seconds));
        var expression = Validation.Text(input.GetProperty("expression"), 200); var zone = Validation.Text(input.GetProperty("timeZone"), 100);
        return !expression.IsSuccess ? Result<WakeSchedule>.Fail(expression.Error) : zone.Map<WakeSchedule>(value => new CronSchedule(expression.Value, value));
    }

    private static Result<WakeRuleInput> Configuration(JsonElement input)
    {
        var name = Validation.Text(input.GetProperty("name"), 100); var message = Validation.PlainText(input.GetProperty("message"), 16384);
        var schedule = Schedule(input.GetProperty("schedule")); var enabled = Validation.Boolean(input.GetProperty("enabled"));
        var ids = Validation.List(input.GetProperty("agentIds"), value => Validation.Text(value).Bind(text => Validation.Identifier(text) ? Result<string>.Success(text) : Results.Fail<string>("invalid", "Invalid target agent")), 1000);
        return name.IsSuccess && message.IsSuccess && schedule.IsSuccess && enabled.IsSuccess && ids.IsSuccess
            ? Result<WakeRuleInput>.Success(new(name.Value, message.Value, schedule.Value, enabled.Value, ids.Value)) : Results.Fail<WakeRuleInput>("invalid", "Invalid wake-up configuration");
    }

    private static ValueTask<Result<ApiReply>> Save(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input, bool create)
    {
        var fields = Validation.Fields(input, create ? ["ruleId", "name", "message", "schedule", "enabled", "agentIds"] : ["expectedRevision", "name", "message", "schedule", "enabled", "agentIds"]);
        if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var configuration = Configuration(input); var id = create ? Inputs.Id(input, "ruleId") : Result<string>.Success(parameters["ruleId"]);
        var revision = create ? Result<long?>.Success(null) : Validation.Integer(input.GetProperty("expectedRevision")).Map<long?>(value => value);
        if (!configuration.IsSuccess || !id.IsSuccess || !revision.IsSuccess) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid wake-up change"));
        return Replies.Ready(Replies.Of(WakeRules.Save(Rules(context), context.Actor, id.Value, configuration.Value, revision.Value, context.RequestId).Map(Details)));
    }

    private static ValueTask<Result<ApiReply>> Delete(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["expectedRevision"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var revision = Validation.Integer(input.GetProperty("expectedRevision"));
        return Replies.Ready(Replies.Of(revision.Bind(value => WakeRules.Delete(Rules(context), context.Actor, parameters["ruleId"], value, context.RequestId)).Map(_ => JsonValues.Object(writer => writer.WriteBoolean("deleted", true)))));
    }

    private static ValueTask<Result<ApiReply>> List(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var page = Transport.Page(context.Query); var owner = context.Query.GetValueOrDefault("ownerId"); var search = context.Query.GetValueOrDefault("search", "");
        if (!page.IsSuccess || owner is not null && !Validation.Identifier(owner) || search.Length > 200 || search.Any(value => value is <= '\u001f' or '\u007f')) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid wake-up filters"));
        return Replies.Ready(Replies.Paged(WakeRules.List(Rules(context), context.Actor, owner, search, page.Value.Page, page.Value.PageSize), context.RequestId, (writer, value) => { writer.WriteStartObject(); Summary(writer, value); writer.WriteEndObject(); }));
    }

    private static ValueTask<Result<ApiReply>> Delivery(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input, string action)
    {
        string? run; string? session;
        if (action is "metadata" or "validate") { run = context.Query.GetValueOrDefault("runId"); session = context.Query.GetValueOrDefault("sessionId"); }
        else
        {
            var fields = Validation.Fields(input, ["runId", "sessionId"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
            var runValue = Validation.Text(input.GetProperty("runId")); var sessionValue = Validation.Text(input.GetProperty("sessionId"), 200);
            if (!runValue.IsSuccess || !sessionValue.IsSuccess) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid native wake attachment")); run = runValue.Value; session = sessionValue.Value;
        }
        if (run is null || !Validation.Identifier(run) || session is null || session.Length is < 1 or > 200 || session.Any(value => value is <= '\u001f' or '\u007f')) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid native wake attachment"));
        var ports = Deliveries(context); var attachment = new WakeAttachment(run, session); var agentId = parameters["agentId"];
        var result = action switch
        {
            "metadata" => WakeDeliveries.Metadata(ports, context.Actor, agentId, attachment).Map(value => JsonValues.Object(writer => { writer.WriteNumber("now", value.Now); JsonValues.Number(writer, "nextDueAt", value.NextDueAt); })),
            "claim" => WakeDeliveries.Claim(ports, context.Actor, agentId, attachment).Map(value => value is null ? JsonValues.Value(writer => writer.WriteNullValue()) : Command(value)),
            "validate" => WakeDeliveries.Validate(ports, context.Actor, agentId, parameters["deliveryId"], attachment).Map(value => JsonValues.Object(writer => writer.WriteBoolean("eligible", value))),
            _ => WakeDeliveries.Acknowledge(ports, context.Actor, agentId, parameters["deliveryId"], attachment).Map(value => JsonValues.Object(writer => writer.WriteBoolean("recorded", value)))
        };
        return Replies.Ready(Replies.Of(result));
    }

    private static void Summary(ProtocolWriter writer, WakeRuleSummary value)
    {
        var rule = value.Rule;
        writer.WriteString("ruleId", rule.Id); writer.WritePropertyName("owner"); DiscoveryViews.Principal(writer, value.Owner); writer.WriteString("configuredById", rule.ConfiguredById); writer.WriteString("name", rule.Name); writer.WriteString("message", rule.Message);
        writer.WriteStartObject("schedule");
        if (rule.Schedule is IntervalSchedule interval) { writer.WriteString("kind", "interval"); writer.WriteNumber("seconds", interval.Seconds); }
        else if (rule.Schedule is CronSchedule cron) { writer.WriteString("kind", "cron"); writer.WriteString("expression", cron.Expression); writer.WriteString("timeZone", cron.TimeZone); }
        writer.WriteEndObject(); writer.WriteBoolean("enabled", rule.Enabled); writer.WriteNumber("revision", rule.Revision); writer.WriteNumber("createdAt", rule.CreatedAt); writer.WriteNumber("updatedAt", rule.UpdatedAt);
        writer.WriteNumber("agentCount", value.AgentCount); JsonValues.Number(writer, "nextDueAt", value.NextDueAt); JsonValues.Number(writer, "lastDeliveredAt", value.LastDeliveredAt);
    }

    private static JsonElement Details(WakeRuleDetails value) => JsonValues.Object(writer =>
    {
        Summary(writer, value.Summary); writer.WriteStartArray("agents");
        foreach (var agent in value.Agents)
        {
            var identity = agent.Identity; var assignment = agent.Assignment;
            writer.WriteStartObject(); writer.WriteString("principalId", identity.PrincipalId); writer.WriteString("matrixUserId", identity.MatrixUserId); writer.WriteString("kind", identity.Kind); writer.WriteString("displayName", identity.DisplayName); writer.WriteString("ownerId", identity.OwnerId); writer.WriteString("ownerMatrixId", identity.OwnerMatrixId);
            writer.WriteString("ruleId", assignment.RuleId); writer.WriteString("agentId", assignment.AgentId); writer.WriteNumber("nextDueAt", assignment.NextDueAt); JsonValues.Number(writer, "lastDeliveredAt", assignment.LastDeliveredAt); writer.WriteEndObject();
        }
        writer.WriteEndArray();
    });

    private static JsonElement Command(ScheduledWake value) => JsonValues.Object(writer =>
    {
        writer.WriteString("deliveryId", value.DeliveryId); writer.WriteString("ruleId", value.RuleId); writer.WriteNumber("ruleRevision", value.RuleRevision); writer.WriteString("name", value.Name); writer.WriteString("message", value.Message);
        writer.WriteNumber("scheduledAt", value.ScheduledAt); writer.WriteString("sessionId", value.SessionId); writer.WriteString("ownerMatrixId", value.OwnerMatrixId); writer.WriteString("authorizerMatrixId", value.AuthorizerMatrixId);
    });
}
