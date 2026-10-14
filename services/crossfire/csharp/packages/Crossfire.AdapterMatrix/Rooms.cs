using Crossfire.AdapterHttp;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public sealed partial class AccountAuthority
{
    public async ValueTask<Result<IReadOnlyList<RoomStateEvent>>> State(string matrixId, string roomId, CancellationToken cancellation = default)
    {
        var account = await AsUser(matrixId, cancellation);
        if (!account.IsSuccess) return Result<IReadOnlyList<RoomStateEvent>>.Fail(account.Error);
        var result = await NativeHttp.Json(client, account.Value, "GET", MatrixJson.Api + "/rooms/" + MatrixJson.Segment(roomId) + "/state", cancellation: cancellation);
        if (!result.IsSuccess) return Result<IReadOnlyList<RoomStateEvent>>.Fail(result.Error);
        using var response = result.Value;
        return response.Status == 200 ? RoomState.Parse(response.Body) : Results.Fail<IReadOnlyList<RoomStateEvent>>("native", "Native room state could not be read");
    }

    public async ValueTask<Result<IReadOnlyList<string>>> Joined(string matrixId, CancellationToken cancellation = default)
    {
        var account = await AsUser(matrixId, cancellation);
        if (!account.IsSuccess) return Result<IReadOnlyList<string>>.Fail(account.Error);
        var result = await MatrixJson.Ok(client, account.Value, "GET", MatrixJson.Api + "/joined_rooms", cancellation: cancellation);
        if (!result.IsSuccess) return Result<IReadOnlyList<string>>.Fail(result.Error);
        if (!result.Value.TryGetProperty("joined_rooms", out var rooms)) return Results.Fail<IReadOnlyList<string>>("native", "Invalid native joined rooms");
        var parsed = Validation.List(rooms, value => value.ValueKind == System.Text.Json.JsonValueKind.String && Validation.RoomId(value.GetString()!)
            ? Result<string>.Success(value.GetString()!) : Results.Fail<string>("native", "Invalid native joined rooms"), 1000);
        return parsed.IsSuccess ? parsed : Results.Fail<IReadOnlyList<string>>("native", "Invalid native joined rooms");
    }

    public async ValueTask<Result<RoomFacts>> Room(string matrixId, string roomId, CancellationToken cancellation = default)
    {
        var state = await State(matrixId, roomId, cancellation);
        if (!state.IsSuccess) return Result<RoomFacts>.Fail(state.Error);
        var membership = RoomState.Content(state.Value, "m.room.member", matrixId);
        if (membership is null || RoomState.String(membership.Value, "membership") != "join") return Results.Fail<RoomFacts>("forbidden", "Owner is not a current room member");
        var powers = RoomState.Content(state.Value, "m.room.power_levels");
        if (powers is null) return Results.Fail<RoomFacts>("native", "Native room power levels are missing");
        var levels = RoomState.Powers(powers.Value, matrixId);
        if (!levels.IsSuccess) return Result<RoomFacts>.Fail(levels.Error);
        var creators = RoomState.Creators(state.Value);
        if (!creators.IsSuccess) return Result<RoomFacts>.Fail(creators.Error);
        var creator = creators.Value.Contains(matrixId, StringComparer.Ordinal);
        var read = Math.Min(Math.Min(creator ? Validation.MaxWireInteger : levels.Value.OwnerLevel, levels.Value.Ceiling),
            Math.Min(levels.Value.Ordinary - 1, Math.Min(levels.Value.Message - 1, levels.Value.Reaction - 1)));
        if (read < -Validation.MaxWireInteger) return Results.Fail<RoomFacts>("native", "Invalid native permission levels");
        var permissions = new List<NativePermission> { new("m.room.message", levels.Value.Message), new("m.reaction", levels.Value.Reaction), new("events_default", levels.Value.Ordinary) };
        foreach (var threshold in new[] { ("invite", 0L), ("kick", 50L), ("ban", 50L), ("redact", 50L), ("state_default", 50L) })
        {
            var value = RoomState.Level(powers.Value, threshold.Item1, threshold.Item2, true);
            if (!value.IsSuccess) return Result<RoomFacts>.Fail(value.Error);
            permissions.Add(new(threshold.Item1, value.Value));
        }
        var events = powers.Value.TryGetProperty("events", out var eventValues) && eventValues.ValueKind == System.Text.Json.JsonValueKind.Object ? eventValues : default;
        if (events.ValueKind == System.Text.Json.JsonValueKind.Object) foreach (var permission in events.EnumerateObject())
        {
            if (permission.Name is "m.room.message" or "m.reaction") continue;
            var value = RoomState.Level(events, permission.Name, 0);
            if (!value.IsSuccess) return Result<RoomFacts>.Fail(value.Error);
            permissions.Add(new(permission.Name, value.Value));
        }
        var name = Text(state.Value, "m.room.name", "name", 255); var topic = Text(state.Value, "m.room.topic", "topic", 4096); var alias = Text(state.Value, "m.room.canonical_alias", "alias", 255);
        var invite = RoomState.Level(powers.Value, "invite", 0, true); var kick = RoomState.Level(powers.Value, "kick", 50, true); var change = RoomState.Level(events, "m.room.power_levels", RoomState.Level(powers.Value, "state_default", 50, true).Value, true);
        return Result<RoomFacts>.Success(new(roomId, string.IsNullOrEmpty(name) ? "Unnamed room" : name, topic ?? "", alias, matrixId,
            creator, creator ? null : levels.Value.OwnerLevel, creators.Value, read, Math.Max(levels.Value.Message, levels.Value.Reaction), invite.Value, kick.Value, change.Value, permissions));
    }

    public async ValueTask<Result<RoomMembership>> Membership(string matrixId, string target, string roomId, CancellationToken cancellation = default)
        => (await MembershipState(matrixId, target, roomId, cancellation)).Map(state => state.Member);

    private sealed record ObservedMembership(RoomMembership Member, long ReadLevel, long ReplyLevel);

    private async ValueTask<Result<ObservedMembership>> MembershipState(string matrixId, string target, string roomId, CancellationToken cancellation)
    {
        var state = await State(matrixId, roomId, cancellation);
        if (!state.IsSuccess) return Result<ObservedMembership>.Fail(state.Error);
        var content = RoomState.Content(state.Value, "m.room.member", target);
        var membership = content is null ? "leave" : RoomState.String(content.Value, "membership") ?? "leave";
        if (membership is not ("join" or "invite" or "leave" or "ban")) return Results.Fail<ObservedMembership>("native", "Unsupported native membership");
        var powers = RoomState.Content(state.Value, "m.room.power_levels");
        if (powers is null) return Results.Fail<ObservedMembership>("native", "Native room power levels are missing");
        var levels = RoomState.Powers(powers.Value, target); var creators = RoomState.Creators(state.Value);
        if (!levels.IsSuccess) return Result<ObservedMembership>.Fail(levels.Error);
        if (!creators.IsSuccess) return Result<ObservedMembership>.Fail(creators.Error);
        var creator = creators.Value.Contains(target, StringComparer.Ordinal);
        var name = content is null ? null : MatrixJson.Text(content.Value, "displayname");
        var member = new RoomMembership(target, name ?? target, membership, creator, creator ? null : levels.Value.OwnerLevel);
        var read = Math.Min(levels.Value.Ceiling, Math.Min(levels.Value.Ordinary - 1, Math.Min(levels.Value.Message - 1, levels.Value.Reaction - 1)));
        return Result<ObservedMembership>.Success(new(member, read, Math.Max(levels.Value.Message, levels.Value.Reaction)));
    }

    public async ValueTask<Result<Unit>> SetDisplayName(string matrixId, string displayName, CancellationToken cancellation = default)
    {
        var account = await AsUser(matrixId, cancellation);
        if (!account.IsSuccess) return Result<Unit>.Fail(account.Error);
        var result = await MatrixJson.Ok(client, account.Value, "PUT", MatrixJson.Api + "/profile/" + MatrixJson.Segment(matrixId) + "/displayname",
            MatrixJson.Object(writer => writer.WriteString("displayname", displayName)), cancellation);
        return result.IsSuccess ? Results.Done() : Result<Unit>.Fail(result.Error);
    }

    public async ValueTask<Result<Unit>> Leave(string matrixId, string roomId, CancellationToken cancellation = default)
    {
        var account = await AsUser(matrixId, cancellation);
        if (!account.IsSuccess) return Result<Unit>.Fail(account.Error);
        var result = await MatrixJson.Ok(client, account.Value, "POST", MatrixJson.Api + "/rooms/" + MatrixJson.Segment(roomId) + "/leave", MatrixJson.Object(_ => { }), cancellation);
        return result.IsSuccess ? Results.Done() : Result<Unit>.Fail(result.Error);
    }

    private static string? Text(IReadOnlyList<RoomStateEvent> state, string type, string key, int maximum)
    {
        var content = RoomState.Content(state, type);
        var value = content is null ? null : RoomState.String(content.Value, key);
        return value is null ? null : value[..Math.Min(value.Length, maximum)];
    }
}
