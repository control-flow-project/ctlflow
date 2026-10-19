using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class RoomPlanRoutes
{
    public static IReadOnlyList<ApiEndpoint> Endpoints() => [new("previewGrants", Preview), new("applyGrants", Apply)];

    private static Result<RoomPlan> Plan(JsonElement input)
    {
        var fields = Validation.Fields(input, ["fleetId", "agents"]); if (!fields.IsSuccess) return Result<RoomPlan>.Fail(fields.Error);
        var fleet = Inputs.Id(input, "fleetId"); if (!fleet.IsSuccess) return Result<RoomPlan>.Fail(fleet.Error);
        return Validation.List(input.GetProperty("agents"), Agent, 100, 1).Map(values => new RoomPlan(fleet.Value, values));
    }

    private static Result<PlannedAgent> Agent(JsonElement input)
    {
        var fields = Validation.Fields(input, ["instanceKey", "grants"]); if (!fields.IsSuccess) return Result<PlannedAgent>.Fail(fields.Error);
        var key = Inputs.Name(input, "instanceKey"); if (!key.IsSuccess) return Result<PlannedAgent>.Fail(key.Error);
        return Validation.List(input.GetProperty("grants"), Grant, 100).Map(values => new PlannedAgent(key.Value, values));
    }

    private static Result<PlannedGrant> Grant(JsonElement input)
    {
        var fields = Validation.Fields(input, ["roomId", "accessMode", "nativeAccess", "muted"]); if (!fields.IsSuccess) return Result<PlannedGrant>.Fail(fields.Error);
        var room = Validation.Text(input.GetProperty("roomId")); var mode = Validation.Choice(input.GetProperty("accessMode"), "read", "reply", "custom");
        var power = MessagingContract.NativeAccess(input.GetProperty("nativeAccess")); var muted = Validation.Boolean(input.GetProperty("muted"));
        return room.IsSuccess && Validation.RoomId(room.Value) && mode.IsSuccess && power.IsSuccess && muted.IsSuccess
            ? Result<PlannedGrant>.Success(new(room.Value, mode.Value, power.Value, muted.Value)) : Results.Fail<PlannedGrant>("invalid", "Invalid planned room access");
    }

    private static Result<AgentGrantSnapshot> Snapshot(JsonElement input)
    {
        var fields = Validation.Fields(input, ["agentId", "revision", "grants"]); if (!fields.IsSuccess) return Result<AgentGrantSnapshot>.Fail(fields.Error);
        var id = Inputs.Id(input, "agentId"); var revision = Validation.Integer(input.GetProperty("revision"));
        if (!id.IsSuccess || !revision.IsSuccess) return Results.Fail<AgentGrantSnapshot>("invalid", "Invalid agent snapshot");
        return Validation.List(input.GetProperty("grants"), value =>
        {
            var checkedFields = Validation.Fields(value, ["roomId", "generation", "revision"]); if (!checkedFields.IsSuccess) return Result<GrantSnapshot>.Fail(checkedFields.Error);
            var room = Validation.Text(value.GetProperty("roomId")); var generation = Inputs.Id(value, "generation"); var version = Validation.Integer(value.GetProperty("revision"));
            return room.IsSuccess && Validation.RoomId(room.Value) && generation.IsSuccess && version.IsSuccess ? Result<GrantSnapshot>.Success(new(room.Value, generation.Value, version.Value)) : Results.Fail<GrantSnapshot>("invalid", "Invalid room snapshot");
        }, 100).Map(values => new AgentGrantSnapshot(id.Value, revision.Value, values));
    }

    private static async ValueTask<Result<ApiReply>> Preview(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["plan"]); if (!fields.IsSuccess) return Result<ApiReply>.Fail(fields.Error);
        var plan = Plan(input.GetProperty("plan")); if (!plan.IsSuccess) return Result<ApiReply>.Fail(plan.Error);
        return Replies.Of((await RoomPlans.Preview(FleetCommands.Ports(context.Database, context.State.Now), RoomGrantCommands.Ports(context.Database, context.State.Now, context.State.Messaging), context.State.Messaging, context.Actor, plan.Value, context.Http.RequestAborted)).Map(View));
    }

    private static async ValueTask<Result<ApiReply>> Apply(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["plan", "digest", "snapshots"]); if (!fields.IsSuccess) return Result<ApiReply>.Fail(fields.Error);
        var plan = Plan(input.GetProperty("plan")); var digest = Validation.Text(input.GetProperty("digest"), 64, 64); var snapshots = Validation.List(input.GetProperty("snapshots"), Snapshot, 100, 1);
        if (!plan.IsSuccess || !digest.IsSuccess || !snapshots.IsSuccess) return Results.Fail<ApiReply>("invalid", "Invalid reviewed room plan");
        return Replies.Of((await RoomPlans.Apply(FleetCommands.Ports(context.Database, context.State.Now), RoomGrantCommands.Ports(context.Database, context.State.Now, context.State.Messaging), context.State.Messaging, context.Actor, plan.Value, digest.Value, snapshots.Value, context.RequestId, context.Http.RequestAborted))
            .Map(agents => JsonValues.Object(writer => { writer.WriteBoolean("accepted", true); JsonValues.Strings(writer, "agents", agents); })));
    }

    private static JsonElement View(RoomPlanPreview value) => JsonValues.Object(writer =>
    {
        writer.WriteString("digest", value.Digest); writer.WriteStartArray("snapshots");
        foreach (var snapshot in value.Snapshots)
        {
            writer.WriteStartObject(); writer.WriteString("agentId", snapshot.AgentId); writer.WriteNumber("revision", snapshot.Revision); writer.WriteStartArray("grants");
            foreach (var grant in snapshot.Grants)
            { writer.WriteStartObject(); writer.WriteString("roomId", grant.RoomId); writer.WriteString("generation", grant.Generation); writer.WriteNumber("revision", grant.Revision); writer.WriteEndObject(); }
            writer.WriteEndArray(); writer.WriteEndObject();
        }
        writer.WriteEndArray(); writer.WriteStartArray("changes");
        foreach (var change in value.Changes)
        {
            var proof = change.Proof; var grant = proof.Input;
            writer.WriteStartObject(); writer.WriteString("agentId", grant.AgentId); writer.WriteString("roomId", grant.RoomId); writer.WriteString("agentName", change.AgentName); writer.WriteString("instanceKey", change.InstanceKey); writer.WriteString("roomName", change.RoomName); writer.WriteString("roomAlias", change.RoomAlias);
            writer.WritePropertyName("before"); if (proof.Previous is null) writer.WriteNullValue(); else RoomViews.Grant(writer, proof.Previous);
            writer.WritePropertyName("after");
            if (grant.AccessMode == "none") writer.WriteNullValue();
            else { writer.WriteStartObject(); writer.WriteString("roomId", grant.RoomId); writer.WriteString("accessMode", grant.AccessMode); RoomViews.NativeAccess(writer, grant.NativeAccess); writer.WriteBoolean("muted", grant.Muted); writer.WriteEndObject(); }
            writer.WriteBoolean("changed", proof.Changed); writer.WriteString("authorizerId", proof.AuthorizerId); writer.WritePropertyName("authority");
            if (proof.Native is { } authority) { writer.WriteStartObject(); MessagingJson.WriteAuthority(writer, authority); writer.WriteEndObject(); } else writer.WriteNullValue(); writer.WriteEndObject();
        }
        writer.WriteEndArray();
    });
}
