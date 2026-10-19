using System.Text.Json;
using Crossfire.AdapterHttp;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public sealed partial class AccountAuthority
{
    public async ValueTask<Result<BackendEvent>> Event(string matrixId, string roomId, string eventId, CancellationToken cancellation = default)
    {
        var account = await AsUser(matrixId, cancellation);
        if (!account.IsSuccess) return Result<BackendEvent>.Fail(account.Error);
        var result = await MatrixJson.Ok(client, account.Value, "GET", MatrixJson.Api + "/rooms/" + MatrixJson.Segment(roomId) + "/event/" + MatrixJson.Segment(eventId), cancellation: cancellation);
        if (!result.IsSuccess) return Result<BackendEvent>.Fail(result.Error);
        var normalized = MessageEvents.Parse(result.Value, roomId);
        if (!normalized.IsSuccess) return Result<BackendEvent>.Fail(normalized.Error);
        var value = normalized.Value;
        if (value.EventId != eventId) return Results.Fail<BackendEvent>("native", "Matrix event identity changed");
        return Result<BackendEvent>.Success(new(value.EventId, value.RoomId, value.Sender, value.Type, value.Content.Kind, value.Content.Body,
            value.Content.Mentions, value.Content.Edited, value.Content.Control));
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
