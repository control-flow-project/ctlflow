using System.Text.Json;
using Crossfire.AdapterHttp;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public sealed partial class AccountAuthority
{
    public async ValueTask<Result<NativeMatrixEvent>> Event(string matrixId, string roomId, string eventId, CancellationToken cancellation = default)
    {
        var account = await AsUser(matrixId, cancellation);
        if (!account.IsSuccess) return Result<NativeMatrixEvent>.Fail(account.Error);
        var result = await MatrixJson.Ok(client, account.Value, "GET", MatrixJson.Api + "/rooms/" + MatrixJson.Segment(roomId) + "/event/" + MatrixJson.Segment(eventId), cancellation: cancellation);
        if (!result.IsSuccess) return Result<NativeMatrixEvent>.Fail(result.Error);
        var input = result.Value;
        var sender = RoomState.String(input, "sender"); var type = RoomState.String(input, "type");
        if (RoomState.String(input, "event_id") != eventId || sender is null || !Validation.UserId(sender) || type is null
            || !input.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Object)
            return Results.Fail<NativeMatrixEvent>("native", "Invalid native event");
        var mentions = content.TryGetProperty("m.mentions", out var mentionValues) ? mentionValues : default;
        var relation = content.TryGetProperty("m.relates_to", out var relationValues) ? relationValues : default;
        var identifiers = mentions.ValueKind == JsonValueKind.Object && mentions.TryGetProperty("user_ids", out var values) && values.ValueKind == JsonValueKind.Array ? values : default;
        var users = new List<string>();
        if (identifiers.ValueKind == JsonValueKind.Array) foreach (var user in identifiers.EnumerateArray())
        {
            if (user.ValueKind != JsonValueKind.String || !Validation.UserId(user.GetString()!)) return Results.Fail<NativeMatrixEvent>("native", "Invalid native mention identities");
            users.Add(user.GetString()!);
        }
        var messageType = RoomState.String(content, "msgtype");
        return Result<NativeMatrixEvent>.Success(new(eventId, roomId, sender, type, messageType, RoomState.String(content, "body"), users,
            content.TryGetProperty("m.new_content", out _) || RoomState.String(relation, "rel_type") == "m.replace",
            type == "m.room.message" && messageType == "m.notice" && content.TryGetProperty("org.crossfire.listener_notice", out var notice) && notice.ValueKind == JsonValueKind.True));
    }

    public async ValueTask<Result<string>> SendNotice(string matrixId, string roomId, string transactionId, string body, string sender, CancellationToken cancellation = default)
    {
        var account = await AsUser(matrixId, cancellation);
        if (!account.IsSuccess) return Result<string>.Fail(account.Error);
        var content = MatrixJson.Object(writer =>
        {
            writer.WriteString("msgtype", "m.notice"); writer.WriteString("body", body);
            writer.WriteStartObject("m.mentions"); writer.WriteStartArray("user_ids"); writer.WriteStringValue(sender); writer.WriteEndArray(); writer.WriteEndObject();
            writer.WriteBoolean("org.crossfire.listener_notice", true);
        });
        var opened = await NativeHttp.Json(client, account.Value, "PUT", MatrixJson.Api + "/rooms/" + MatrixJson.Segment(roomId)
            + "/send/m.room.message/" + MatrixJson.Segment(transactionId), content, cancellation: cancellation);
        if (!opened.IsSuccess) return Result<string>.Fail(opened.Error);
        using var response = opened.Value;
        if (response.Status == 403) return Results.Fail<string>("forbidden", "Native room rules do not permit this notice");
        var id = RoomState.String(response.Body, "event_id");
        return response.Status == 200 && id is not null ? Result<string>.Success(id) : Results.Fail<string>("native", "Notice publication remains unconfirmed");
    }
}
