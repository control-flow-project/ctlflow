using System.Text.Json;
using Crossfire.Kernel;
using Crossfire.Contracts;

namespace Crossfire.AdapterMatrix;

public sealed record RoomStateEvent(string Sender, string Type, string StateKey, JsonElement Content, string? EventId = null);
public sealed record RoomPowers(long OwnerLevel, long Ceiling, long Ordinary, long Message, long Reaction);

public static class RoomState
{
    public static Result<IReadOnlyList<RoomStateEvent>> Parse(JsonElement input)
    {
        if (input.ValueKind != JsonValueKind.Array) return Results.Fail<IReadOnlyList<RoomStateEvent>>("native", "Native room state could not be read");
        var events = new List<RoomStateEvent>();
        foreach (var value in input.EnumerateArray())
        {
            if (value.ValueKind != JsonValueKind.Object) return Results.Fail<IReadOnlyList<RoomStateEvent>>("native", "Invalid native state event");
            var sender = String(value, "sender"); var type = String(value, "type"); var key = String(value, "state_key");
            if (sender is null || type is null || key is null || !value.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Object)
                return Results.Fail<IReadOnlyList<RoomStateEvent>>("native", "Invalid native state identity");
            events.Add(new(sender, type, key, content.Clone(), String(value, "event_id")));
        }
        return Result<IReadOnlyList<RoomStateEvent>>.Success(events);
    }

    public static string? String(JsonElement input, string key)
        => input.ValueKind == JsonValueKind.Object && input.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    public static JsonElement? Content(IReadOnlyList<RoomStateEvent> events, string type, string stateKey = "")
        => events.FirstOrDefault(value => value.Type == type && value.StateKey == stateKey)?.Content;

    public static Result<IReadOnlyList<string>> Creators(IReadOnlyList<RoomStateEvent> events)
    {
        var creation = events.FirstOrDefault(value => value.Type == "m.room.create" && value.StateKey == "");
        if (creation is null || !MatrixSyntax.UserId(creation.Sender)) return Results.Fail<IReadOnlyList<string>>("native", "Native room creation state is missing or invalid");
        if (String(creation.Content, "room_version") != "12") return Result<IReadOnlyList<string>>.Success([]);
        var result = new List<string> { creation.Sender };
        if (creation.Content.TryGetProperty("additional_creators", out var additional) && additional.ValueKind != JsonValueKind.Null)
        {
            if (additional.ValueKind != JsonValueKind.Array) return Results.Fail<IReadOnlyList<string>>("native", "Invalid native creator identities");
            foreach (var creator in additional.EnumerateArray())
            {
                if (creator.ValueKind != JsonValueKind.String || !MatrixSyntax.UserId(creator.GetString()!)) return Results.Fail<IReadOnlyList<string>>("native", "Invalid native creator identities");
                if (!result.Contains(creator.GetString()!, StringComparer.Ordinal)) result.Add(creator.GetString()!);
            }
        }
        return Result<IReadOnlyList<string>>.Success(result);
    }

    public static Result<long> Level(JsonElement input, string key, long fallback, bool nullish = false)
    {
        if (input.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null || !input.TryGetProperty(key, out var value)
            || nullish && value.ValueKind == JsonValueKind.Null) return Result<long>.Success(fallback);
        var parsed = Validation.Integer(value, -Validation.MaxWireInteger, Validation.MaxWireInteger);
        return parsed.IsSuccess ? parsed : Results.Fail<long>("native", "Invalid native power level");
    }

    public static Result<RoomPowers> Powers(JsonElement powers, string owner)
    {
        var users = powers.TryGetProperty("users", out var userValues) && userValues.ValueKind != JsonValueKind.Null ? userValues : default;
        var events = powers.TryGetProperty("events", out var eventValues) && eventValues.ValueKind != JsonValueKind.Null ? eventValues : default;
        if (users.ValueKind is not (JsonValueKind.Object or JsonValueKind.Undefined) || events.ValueKind is not (JsonValueKind.Object or JsonValueKind.Undefined))
            return Results.Fail<RoomPowers>("native", "Invalid native power-level maps");
        var defaults = Level(powers, "users_default", 0); var ordinary = Level(powers, "events_default", 0); var state = Level(powers, "state_default", 50);
        if (!defaults.IsSuccess) return Result<RoomPowers>.Fail(defaults.Error);
        if (!ordinary.IsSuccess) return Result<RoomPowers>.Fail(ordinary.Error);
        if (!state.IsSuccess) return Result<RoomPowers>.Fail(state.Error);
        var ownerLevel = Level(users, owner, defaults.Value); var message = Level(events, "m.room.message", ordinary.Value); var reaction = Level(events, "m.reaction", ordinary.Value);
        if (!ownerLevel.IsSuccess) return Result<RoomPowers>.Fail(ownerLevel.Error);
        if (!message.IsSuccess) return Result<RoomPowers>.Fail(message.Error);
        if (!reaction.IsSuccess) return Result<RoomPowers>.Fail(reaction.Error);
        var thresholds = new List<Result<long>> { Level(powers, "invite", 0, true), Level(powers, "kick", 50, true), Level(powers, "ban", 50, true), Level(powers, "redact", 50, true), state };
        if (events.ValueKind == JsonValueKind.Object) foreach (var permission in events.EnumerateObject())
            if (permission.Name is not ("m.room.message" or "m.reaction")) thresholds.Add(Level(events, permission.Name, 0));
        if (thresholds.Any(value => !value.IsSuccess)) return Results.Fail<RoomPowers>("native", "Invalid native permission thresholds");
        var ceiling = thresholds.Min(value => value.Value) - 1;
        return ceiling < -Validation.MaxWireInteger ? Results.Fail<RoomPowers>("native", "Native power ceiling cannot be represented")
            : Result<RoomPowers>.Success(new(ownerLevel.Value, ceiling, ordinary.Value, message.Value, reaction.Value));
    }

    public static Result<Unit> OwnerConversation(IReadOnlyList<RoomStateEvent> events, string owner, string agent)
    {
        var creation = events.FirstOrDefault(value => value.Type == "m.room.create" && value.StateKey == "");
        var creators = Creators(events);
        if (!creators.IsSuccess) return Result<Unit>.Fail(creators.Error);
        if (!MatrixSyntax.UserId(owner) || !MatrixSyntax.UserId(agent) || owner == agent || creation?.Sender != owner
            || creators.Value.Any(identity => identity != owner && identity != agent) || events.Any(value => value.Type == "m.room.encryption")
            || !Content(events, "m.room.join_rules").HasValue || String(Content(events, "m.room.join_rules")!.Value, "join_rule") != "invite"
            || Content(events, "m.room.history_visibility") is { } visibility && String(visibility, "history_visibility") == "world_readable"
            || events.Any(value => value.Type == "m.room.member" && String(value.Content, "membership") is "join" or "invite" && value.StateKey != owner && value.StateKey != agent))
            return Results.Fail<Unit>("forbidden", "Owner messages require a private unencrypted conversation containing only the owner and this agent");
        return Results.Done();
    }
}
