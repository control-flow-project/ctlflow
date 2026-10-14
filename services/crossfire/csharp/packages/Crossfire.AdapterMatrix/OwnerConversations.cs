using System.Text;
using System.Text.Json;
using Crossfire.AdapterHttp;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public sealed partial class AccountAuthority
{
    private async ValueTask<Result<Dictionary<string, string[]>>> DirectRooms(NativeEndpoint account, string identity, CancellationToken cancellation)
    {
        var opened = await NativeHttp.Json(client, account, "GET", MatrixJson.Api + "/user/" + MatrixJson.Segment(identity) + "/account_data/m.direct", cancellation: cancellation);
        if (!opened.IsSuccess) return Result<Dictionary<string, string[]>>.Fail(opened.Error);
        using var response = opened.Value;
        var rooms = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (response.Status == 404) return Result<Dictionary<string, string[]>>.Success(rooms);
        if (response.Status != 200 || response.Body.ValueKind != JsonValueKind.Object || response.Body.EnumerateObject().Count() > 2000)
            return Results.Fail<Dictionary<string, string[]>>("native", "Native direct-message account data is unavailable");
        foreach (var property in response.Body.EnumerateObject())
        {
            if (!Validation.UserId(property.Name) || property.Value.ValueKind != JsonValueKind.Array || property.Value.GetArrayLength() > 1000)
                return Results.Fail<Dictionary<string, string[]>>("native", "Invalid native direct-message account data");
            var identifiers = new List<string>();
            foreach (var item in property.Value.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.String || !Validation.RoomId(item.GetString()!))
                    return Results.Fail<Dictionary<string, string[]>>("native", "Invalid native direct-message account data");
                identifiers.Add(item.GetString()!);
            }
            rooms[property.Name] = identifiers.ToArray();
        }
        return Result<Dictionary<string, string[]>>.Success(rooms);
    }

    public async ValueTask<Result<Unit>> MarkDirect(string identity, string counterpart, string roomId, CancellationToken cancellation = default)
    {
        var account = await AsUser(identity, cancellation);
        if (!account.IsSuccess) return Result<Unit>.Fail(account.Error);
        var current = await DirectRooms(account.Value, identity, cancellation);
        if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
        if (current.Value.TryGetValue(counterpart, out var rooms) && rooms.Contains(roomId, StringComparer.Ordinal)) return Results.Done();
        current.Value[counterpart] = [roomId, .. rooms ?? []];
        var content = MatrixJson.Object(writer =>
        {
            foreach (var entry in current.Value)
            {
                writer.WriteStartArray(entry.Key);
                foreach (var room in entry.Value) writer.WriteStringValue(room);
                writer.WriteEndArray();
            }
        });
        return (await MatrixJson.Ok(client, account.Value, "PUT", MatrixJson.Api + "/user/" + MatrixJson.Segment(identity) + "/account_data/m.direct", content, cancellation)).Map(_ => default(Unit));
    }

    public async ValueTask<Result<Unit>> VerifyOwnerConversation(string owner, string agent, string roomId, CancellationToken cancellation = default)
    {
        if (!Validation.UserId(owner) || !Validation.UserId(agent) || !Validation.RoomId(roomId) || owner == agent)
            return Results.Fail<Unit>("invalid", "Invalid owner conversation identities");
        var state = await State(owner, roomId, cancellation);
        return state.IsSuccess ? RoomState.OwnerConversation(state.Value, owner, agent) : Result<Unit>.Fail(state.Error);
    }

    public ValueTask<Result<string>> OwnerConversation(string owner, string agent, string? selectedRoom, string? previousName, CancellationToken cancellation = default)
        => Exclusive("owner-conversation:" + owner, linked => EnsureOwnerConversation(owner, agent, selectedRoom, previousName, linked), cancellation);

    private async ValueTask<Result<string>> EnsureOwnerConversation(string owner, string agent, string? selectedRoom, string? previousName, CancellationToken cancellation)
    {
        if (!Local(owner) || !Local(agent) || owner == agent || selectedRoom is not null && !Validation.RoomId(selectedRoom))
            return Results.Fail<string>("invalid", "Invalid owner conversation identities");
        var ownerAccount = await AsUser(owner, cancellation); var agentAccount = await AsUser(agent, cancellation);
        if (!ownerAccount.IsSuccess) return Result<string>.Fail(ownerAccount.Error);
        if (!agentAccount.IsSuccess) return Result<string>.Fail(agentAccount.Error);
        var room = selectedRoom;
        if (room is null)
        {
            var current = await DirectRooms(ownerAccount.Value, owner, cancellation);
            if (!current.IsSuccess) return Result<string>.Fail(current.Error);
            foreach (var candidate in current.Value.GetValueOrDefault(agent, []))
            {
                var verified = await VerifyOwnerConversation(owner, agent, candidate, cancellation);
                if (verified.IsSuccess) { room = candidate; break; }
                if (verified.Error.Code != "forbidden") return Result<string>.Fail(verified.Error);
            }
        }
        if (room is null)
        {
            var encoded = new StringBuilder("["); ProtocolJson.String(encoded, owner); encoded.Append(','); ProtocolJson.String(encoded, agent); encoded.Append(']');
            var alias = "crossfire-owner-" + Kernel.Identity.Hash(encoded.ToString());
            var path = MatrixJson.Api + "/directory/room/" + MatrixJson.Segment("#" + alias + ":" + configuration.ServerName);
            var found = await NativeHttp.Json(client, ownerAccount.Value, "GET", path, cancellation: cancellation);
            if (!found.IsSuccess) return Result<string>.Fail(found.Error);
            using (var response = found.Value)
            {
                if (response.Status == 200) room = MatrixJson.Text(response.Body, "room_id");
                else if (response.Status == 404)
                {
                    var name = await ConversationName(agent, cancellation);
                    if (!name.IsSuccess) return Result<string>.Fail(name.Error);
                    var content = MatrixJson.Object(writer =>
                    {
                        writer.WriteString("preset", "private_chat"); writer.WriteString("visibility", "private"); writer.WriteBoolean("is_direct", true);
                        writer.WriteString("name", name.Value); writer.WriteString("room_alias_name", alias);
                        writer.WriteStartArray("invite"); writer.WriteStringValue(agent); writer.WriteEndArray();
                        writer.WriteStartObject("power_level_content_override"); writer.WriteNumber("invite", 100); writer.WriteEndObject();
                    });
                    var created = await NativeHttp.Json(client, ownerAccount.Value, "POST", MatrixJson.Api + "/createRoom", content, cancellation: cancellation);
                    if (!created.IsSuccess) return Result<string>.Fail(created.Error);
                    using var creation = created.Value;
                    if (creation.Status == 200) room = MatrixJson.Text(creation.Body, "room_id");
                    else if (creation.Status == 400 && MatrixJson.Error(creation.Body, "M_ROOM_IN_USE"))
                    {
                        var existing = await MatrixJson.Ok(client, ownerAccount.Value, "GET", path, cancellation: cancellation);
                        if (!existing.IsSuccess) return Result<string>.Fail(existing.Error);
                        room = MatrixJson.Text(existing.Value, "room_id");
                    }
                    else return Results.Fail<string>("native", "Native owner conversation creation was not confirmed");
                }
                else return Results.Fail<string>("native", "Native owner conversation recovery was not confirmed");
            }
            if (room is null || !Validation.RoomId(room)) return Results.Fail<string>("native", "Native owner conversation recovery was not confirmed");
        }
        var privateRoom = await VerifyOwnerConversation(owner, agent, room, cancellation);
        if (!privateRoom.IsSuccess) return Result<string>.Fail(privateRoom.Error);
        var members = await State(owner, room, cancellation);
        if (!members.IsSuccess) return Result<string>.Fail(members.Error);
        var titleContent = RoomState.Content(members.Value, "m.room.name");
        var title = titleContent is null ? null : RoomState.String(titleContent.Value, "name");
        if (titleContent is { } nameContent && nameContent.TryGetProperty("name", out var nameValue) && nameValue.ValueKind != JsonValueKind.String)
            return Results.Fail<string>("native", "Invalid native conversation name");
        if (title is null || TextRules.Blank(title) || previousName is not null && title == previousName)
        {
            var name = await ConversationName(agent, cancellation);
            if (!name.IsSuccess) return Result<string>.Fail(name.Error);
            var named = await MatrixJson.Ok(client, ownerAccount.Value, "PUT", MatrixJson.Api + "/rooms/" + MatrixJson.Segment(room) + "/state/m.room.name",
                MatrixJson.Object(writer => writer.WriteString("name", name.Value)), cancellation);
            if (!named.IsSuccess) return Result<string>.Fail(named.Error);
        }
        foreach (var identity in new[] { owner, agent })
        {
            var member = RoomState.Content(members.Value, "m.room.member", identity);
            var membership = member is null ? null : RoomState.String(member.Value, "membership");
            var path = MatrixJson.Api + "/rooms/" + MatrixJson.Segment(room);
            if (membership == "ban")
            {
                var unbanned = await MatrixJson.Ok(client, ownerAccount.Value, "POST", path + "/unban", MatrixJson.Object(writer => writer.WriteString("user_id", identity)), cancellation);
                if (!unbanned.IsSuccess) return Result<string>.Fail(unbanned.Error);
            }
            if (membership == "join") continue;
            if (identity == agent && membership != "invite")
            {
                var invited = await MatrixJson.Ok(client, ownerAccount.Value, "POST", path + "/invite", MatrixJson.Object(writer => writer.WriteString("user_id", agent)), cancellation);
                if (!invited.IsSuccess) return Result<string>.Fail(invited.Error);
            }
            var joined = await MatrixJson.Ok(client, identity == owner ? ownerAccount.Value : agentAccount.Value, "POST", MatrixJson.Api + "/join/" + MatrixJson.Segment(room), MatrixJson.Object(_ => { }), cancellation);
            if (!joined.IsSuccess) return Result<string>.Fail(joined.Error);
        }
        var final = await VerifyOwnerConversation(owner, agent, room, cancellation);
        if (!final.IsSuccess) return Result<string>.Fail(final.Error);
        var markedOwner = await MarkDirect(owner, agent, room, cancellation);
        if (!markedOwner.IsSuccess) return Result<string>.Fail(markedOwner.Error);
        return (await MarkDirect(agent, owner, room, cancellation)).Map(_ => room);
    }

    private async ValueTask<Result<string>> ConversationName(string agent, CancellationToken cancellation)
    {
        var name = await ProfileName(agent, cancellation);
        if (!name.IsSuccess) return Result<string>.Fail(name.Error);
        return name.Value is { Length: > 0 and <= 255 } value && !TextRules.Blank(value) ? Result<string>.Success(value)
            : Results.Fail<string>("native", "Invalid native agent display name");
    }
}
