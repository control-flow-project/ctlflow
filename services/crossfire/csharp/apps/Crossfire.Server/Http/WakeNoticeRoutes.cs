using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class WakeNoticeRoutes
{
    public static IReadOnlyList<ApiEndpoint> Endpoints() => [new("wakeNotice", Request)];
    private static async ValueTask<Result<ApiReply>> Request(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["roomId"]); if (!fields.IsSuccess) return Result<ApiReply>.Fail(fields.Error);
        var room = Validation.Text(input.GetProperty("roomId")); if (!room.IsSuccess || !Validation.RoomId(room.Value)) return Results.Fail<ApiReply>("invalid", "Invalid notice room");
        return Replies.Of((await WakeNotices.Request(WakeNoticeQueries.Ports(context.Database, context.State.Now, context.State.Messaging), context.Actor,
            parameters["agentId"], room.Value, parameters["eventId"], context.Http.RequestAborted)).Map(outcome => JsonValues.Object(writer => writer.WriteString("outcome", outcome))));
    }
}
