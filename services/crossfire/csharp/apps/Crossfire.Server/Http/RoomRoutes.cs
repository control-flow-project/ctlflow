using System.Text;
using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class RoomRoutes
{
    private static RoomGrantPorts Grants(ApiContext context) => RoomGrantCommands.Ports(context.Database, context.State.Now, context.State.Matrix.Room);
    private static OwnerConversationPorts Conversations(ApiContext context) => OwnerConversationCommands.Ports(context.Database, context.State.Now, context.State.Matrix.Ports(), context.State.Matrix.RoomOperation);
    public static IReadOnlyList<ApiEndpoint> Endpoints() =>
    [
        new("ownerConversation", Owner), new("acceptRoomInvitation", Accept), new("rooms", Rooms, ["page", "pageSize", "agentId", "search"]), new("room", Room, ["agentId"]),
        new("grants", List, ["page", "pageSize", "roomIds"]), new("grant", Read), new("grantPermissions", Read),
        new("setGrant", (context, parameters, input) => Change(context, parameters, input, false)), new("removeGrant", (context, parameters, input) => Change(context, parameters, input, true)),
        new("setGrantPermissions", Permissions)
    ];

    private static async ValueTask<Result<ApiReply>> Owner(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, []); if (!fields.IsSuccess) return Result<ApiReply>.Fail(fields.Error);
        var authority = Authorization.Require(context.Authorization, context.Actor, "owner-conversation.ensure.self"); if (!authority.IsSuccess) return Result<ApiReply>.Fail(authority.Error);
        if (context.Actor.Kind != "agent" || context.Actor.PrincipalId != parameters["agentId"]) return Results.Fail<ApiReply>("forbidden", "Only this agent can connect its owner conversation");
        return Replies.Of((await OwnerConversations.Ensure(Conversations(context), parameters["agentId"], cancellation: context.Http.RequestAborted)).Map(value => JsonValues.Object(writer => writer.WriteString("roomId", value))));
    }

    private static async ValueTask<Result<ApiReply>> Accept(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["roomId"]); if (!fields.IsSuccess) return Result<ApiReply>.Fail(fields.Error);
        var room = Validation.Text(input.GetProperty("roomId")); if (!room.IsSuccess || !Validation.RoomId(room.Value)) return Results.Fail<ApiReply>("invalid", "Invalid invited room");
        return Replies.Of((await RoomInvitations.Accept(Conversations(context), id => MemberQueries.ByMatrixId(context.Database, id), context.Actor, parameters["agentId"], room.Value, context.RequestId, context.Http.RequestAborted))
            .Map(accepted => JsonValues.Object(writer => writer.WriteBoolean("accepted", accepted))));
    }

    private static async ValueTask<Result<ApiReply>> Rooms(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var page = Transport.Page(context.Query); if (!page.IsSuccess) return Result<ApiReply>.Fail(page.Error);
        var agent = context.Query.GetValueOrDefault("agentId"); var search = context.Query.GetValueOrDefault("search", "");
        if (agent is not null && !Validation.Identifier(agent) || search.Length > 200 || search.Any(value => value is <= '\u001f' or '\u007f')) return Results.Fail<ApiReply>("invalid", "Invalid room filters");
        return Replies.Paged(await RoomReads.List(Grants(context), context.State.Matrix.Ports(), context.Actor, page.Value.Page, page.Value.PageSize, search, agent, context.Http.RequestAborted), context.RequestId, RoomViews.Room);
    }

    private static async ValueTask<Result<ApiReply>> Room(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var agent = context.Query.GetValueOrDefault("agentId"); if (agent is not null && !Validation.Identifier(agent)) return Results.Fail<ApiReply>("invalid", "Invalid room agent context");
        return Replies.Of((await RoomReads.Read(Grants(context), context.State.Matrix.Ports(), context.Actor, parameters["roomId"], agent, context.Http.RequestAborted)).Map(value => JsonValues.Value(writer => RoomViews.Room(writer, value))));
    }

    private static Result<IReadOnlyList<string>?> Filter(string? value)
    {
        if (value is null) return Result<IReadOnlyList<string>?>.Success(null);
        if (Encoding.UTF8.GetByteCount(value) > 16384) return Results.Fail<IReadOnlyList<string>?>("invalid", "Room filter exceeds its size bound");
        try
        {
            using var document = JsonDocument.Parse(value);
            var parsed = Validation.List(document.RootElement, element => Validation.Text(element).Bind(text => Validation.RoomId(text) ? Result<string>.Success(text) : Results.Fail<string>("invalid", "Invalid room ID")), 100);
            return !parsed.IsSuccess ? Result<IReadOnlyList<string>?>.Fail(parsed.Error) : parsed.Value.Distinct(StringComparer.Ordinal).Count() != parsed.Value.Count ? Results.Fail<IReadOnlyList<string>?>("invalid", "Duplicate room filter") : Result<IReadOnlyList<string>?>.Success(parsed.Value);
        }
        catch (JsonException) { return Results.Fail<IReadOnlyList<string>?>("invalid", "roomIds must be a JSON array"); }
    }

    private static ValueTask<Result<ApiReply>> List(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var page = Transport.Page(context.Query); if (!page.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(page.Error));
        var filter = Filter(context.Query.GetValueOrDefault("roomIds"));
        return Replies.Ready(filter.IsSuccess ? Replies.Paged(RoomGrantReads.List(RoomGrantReadQueries.Ports(context.Database, context.State.Now, context.State.Matrix.Room), context.Actor, parameters["agentId"], page.Value.Page, page.Value.PageSize, filter.Value), context.RequestId, RoomViews.View) : Result<ApiReply>.Fail(filter.Error));
    }

    private static async ValueTask<Result<ApiReply>> Read(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
        => Replies.Of((await RoomGrantReads.Read(Grants(context), context.Actor, parameters["agentId"], parameters["roomId"], context.Http.RequestAborted)).Map(value => JsonValues.Value(writer => RoomViews.View(writer, value))));

    private static async ValueTask<Result<ApiReply>> Change(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input, bool remove)
    {
        var fields = Validation.Fields(input, remove ? ["expectedRevision", "expectedGeneration"] : ["expectedRevision", "expectedGeneration", "accessMode", "powerLevel", "muted"]); if (!fields.IsSuccess) return Result<ApiReply>.Fail(fields.Error);
        var revision = Validation.Integer(input.GetProperty("expectedRevision")); var generation = Validation.NullableText(input.GetProperty("expectedGeneration"));
        var access = remove ? Result<string>.Success("none") : Validation.Choice(input.GetProperty("accessMode"), "read", "reply", "custom");
        var power = remove ? Result<long?>.Success(null) : Validation.NullableInteger(input.GetProperty("powerLevel"), -Validation.MaxWireInteger);
        var muted = remove ? Result<bool>.Success(false) : Validation.Boolean(input.GetProperty("muted"));
        if (!revision.IsSuccess || !generation.IsSuccess || generation.Value is not null && !Validation.Identifier(generation.Value) || !access.IsSuccess || !power.IsSuccess || !muted.IsSuccess) return Results.Fail<ApiReply>("invalid", "Invalid room access change");
        var changed = await RoomGrantChanges.Change(Grants(context), context.Actor, new(parameters["agentId"], parameters["roomId"], revision.Value, generation.Value, access.Value, power.Value, muted.Value), context.RequestId, cancellation: context.Http.RequestAborted);
        return changed.IsSuccess ? await Read(context, parameters, input) : Result<ApiReply>.Fail(changed.Error);
    }

    private static async ValueTask<Result<ApiReply>> Permissions(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["expectedRevision", "expectedGeneration", "permissions"]); if (!fields.IsSuccess) return Result<ApiReply>.Fail(fields.Error);
        var revision = Validation.Integer(input.GetProperty("expectedRevision")); var generation = Inputs.Id(input, "expectedGeneration"); var permissions = Validation.List(input.GetProperty("permissions"), value => Validation.Choice(value, "room.agent.invite"), 1);
        if (!revision.IsSuccess || !generation.IsSuccess || !permissions.IsSuccess) return Results.Fail<ApiReply>("invalid", "Invalid room permissions");
        var changed = RoomPermissions.Set(Grants(context), context.Actor, parameters["agentId"], parameters["roomId"], revision.Value, generation.Value, permissions.Value, context.RequestId);
        return changed.IsSuccess ? await Read(context, parameters, input) : Result<ApiReply>.Fail(changed.Error);
    }
}
