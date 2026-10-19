using System.Text.Json;
using Crossfire.AdapterHttp;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public sealed partial class MessageClient
{
    private static Result<JsonElement> Section(JsonElement parent, string name, JsonValueKind kind)
    {
        if (parent.ValueKind != JsonValueKind.Object) return Results.Fail<JsonElement>("native", "Invalid Matrix feed section");
        if (!parent.TryGetProperty(name, out var value)) return Result<JsonElement>.Success(kind == JsonValueKind.Object ? WireJson.Object(_ => { }) : WireJson.Array(_ => { }));
        return value.ValueKind == kind ? Result<JsonElement>.Success(value) : Results.Fail<JsonElement>("native", "Invalid Matrix feed section");
    }

    private static Result<IReadOnlyList<JsonElement>> FeedEvents(JsonElement room, string section)
    {
        var container = Section(room, section, JsonValueKind.Object);
        if (!container.IsSuccess) return Result<IReadOnlyList<JsonElement>>.Fail(container.Error);
        var events = Section(container.Value, "events", JsonValueKind.Array);
        return events.IsSuccess ? Result<IReadOnlyList<JsonElement>>.Success(events.Value.EnumerateArray().Select(value => value.Clone()).ToArray()) : Result<IReadOnlyList<JsonElement>>.Fail(events.Error);
    }

    private bool OwnMembership(JsonElement value) => WireJson.Text(value, "type") == "m.room.member" && WireJson.Text(value, "state_key") == self;
    private bool MembershipChanged(JsonElement value)
    {
        if (!OwnMembership(value) || !value.TryGetProperty("content", out var content)) return false;
        var membership = WireJson.Text(content, "membership");
        if (membership is "leave" or "ban") return true;
        return membership == "join" && value.TryGetProperty("unsigned", out var unsigned) && unsigned.ValueKind == JsonValueKind.Object
            && unsigned.TryGetProperty("prev_content", out var previous) && WireJson.Text(previous, "membership") is "leave" or "ban" or "invite" or "knock";
    }

    private async ValueTask<Result<MessageFeed>> Synchronize(string? since, int timeout, CancellationToken cancellation)
    {
        var limit = 100; JsonElement native;
        for (;;)
        {
            var filter = WireJson.Object(writer =>
            {
                writer.WriteStartObject("presence"); writer.WriteStartArray("types"); writer.WriteEndArray(); writer.WriteEndObject();
                writer.WriteStartObject("account_data"); writer.WriteStartArray("types"); writer.WriteEndArray(); writer.WriteEndObject();
                writer.WriteStartObject("room"); writer.WriteStartObject("timeline"); writer.WriteNumber("limit", limit); writer.WriteStartArray("types"); foreach (var type in MessageEvents.Types.Keys) writer.WriteStringValue(type); writer.WriteEndArray(); writer.WriteEndObject();
                writer.WriteStartObject("state"); writer.WriteStartArray("types"); writer.WriteStringValue("m.room.member"); writer.WriteEndArray(); writer.WriteEndObject();
                writer.WriteStartObject("ephemeral"); writer.WriteStartArray("types"); writer.WriteEndArray(); writer.WriteEndObject();
                writer.WriteStartObject("account_data"); writer.WriteStartArray("types"); writer.WriteStringValue("m.fully_read"); writer.WriteStringValue("m.marked_unread"); writer.WriteEndArray(); writer.WriteEndObject(); writer.WriteEndObject();
            });
            var query = new Dictionary<string, string> { ["timeout"] = timeout.ToString(System.Globalization.CultureInfo.InvariantCulture), ["filter"] = WireJson.Compact(filter) };
            if (since is not null) query["since"] = since;
            var received = await Request("GET", MatrixJson.Api + "/sync" + Query(query), null, cancellation, limit <= 1 ? CollectionBytes : NativeHttp.MaxJsonBytes);
            if (received.IsSuccess) { native = received.Value; break; }
            if (received.Error.Code != "body_too_large") return Result<MessageFeed>.Fail(received.Error);
            if (limit == 0) return Results.Fail<MessageFeed>("limit", "Matrix sync state exceeds the collection resource bound; unread positions are unchanged");
            limit /= 2;
        }
        var cursor = WireJson.Text(native, "next_batch");
        if (string.IsNullOrEmpty(cursor)) return Results.Fail<MessageFeed>("native", "Matrix sync has no continuation");
        var nativeRooms = Section(native, "rooms", JsonValueKind.Object);
        if (!nativeRooms.IsSuccess) return Result<MessageFeed>.Fail(nativeRooms.Error);
        var joined = Section(nativeRooms.Value, "join", JsonValueKind.Object); var invited = Section(nativeRooms.Value, "invite", JsonValueKind.Object); var departed = Section(nativeRooms.Value, "leave", JsonValueKind.Object);
        if (!joined.IsSuccess || !invited.IsSuccess || !departed.IsSuccess) return Results.Fail<MessageFeed>("native", "Invalid Matrix membership feed");
        var invitations = invited.Value.EnumerateObject().Select(field => field.Name).ToArray(); var departures = departed.Value.EnumerateObject().Select(field => field.Name).ToArray();
        if (invitations.Concat(departures).Any(room => !MatrixSyntax.RoomId(room))) return Results.Fail<MessageFeed>("native", "Invalid Matrix membership feed identity");
        var resets = departures.ToHashSet(StringComparer.Ordinal); var rooms = new Dictionary<string, RoomFeed>(StringComparer.Ordinal);
        foreach (var room in joined.Value.EnumerateObject())
        {
            if (!MatrixSyntax.RoomId(room.Name)) return Results.Fail<MessageFeed>("native", "Invalid Matrix joined-room identity");
            var timeline = Section(room.Value, "timeline", JsonValueKind.Object); var events = FeedEvents(room.Value, "timeline"); var state = FeedEvents(room.Value, "state"); var read = FeedEvents(room.Value, "account_data");
            if (!timeline.IsSuccess || !events.IsSuccess || !state.IsSuccess || !read.IsSuccess) return Results.Fail<MessageFeed>("native", "Invalid Matrix room feed");
            var limited = false;
            if (timeline.Value.TryGetProperty("limited", out var selected)) { if (selected.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return Results.Fail<MessageFeed>("native", "Invalid Matrix timeline limit"); limited = selected.GetBoolean(); }
            if (since is not null && state.Value.Concat(events.Value).Any(OwnMembership))
            {
                if (state.Value.Any(MembershipChanged) || events.Value.Any(MembershipChanged)) resets.Add(room.Name);
                if (limited)
                {
                    var from = since; var visited = new HashSet<string>(StringComparer.Ordinal);
                    for (;;)
                    {
                        var page = await ReadHistory(room.Name, new("forward", 100, from, cursor, new(["membership"])), cancellation);
                        if (!page.IsSuccess) return Result<MessageFeed>.Fail(page.Error);
                        if (page.Value.Events.Any(MembershipChanged)) resets.Add(room.Name);
                        if (page.Value.Events.Count == 0 || page.Value.End == cursor) break;
                        if (page.Value.End is not { } next || !visited.Add(next)) return Results.Fail<MessageFeed>("native", "Matrix membership history repeated a continuation");
                        from = next;
                    }
                }
            }
            var normalized = new List<MessageEvent>();
            foreach (var value in events.Value) { var parsed = MessageEvents.Parse(value, room.Name); if (!parsed.IsSuccess) return Result<MessageFeed>.Fail(parsed.Error); normalized.Add(parsed.Value); }
            rooms.Add(room.Name, new(normalized, limited, WireJson.Text(timeline.Value, "prev_batch"), room.Value.TryGetProperty("unread_notifications", out var notifications) ? notifications.Clone() : null,
                read.Value.Where(value => WireJson.Text(value, "type") is "m.fully_read" or "m.marked_unread").ToArray()));
        }
        return Result<MessageFeed>.Success(new(cursor, rooms, invitations, departures, resets.ToArray()));
    }

    private async ValueTask<Result<IReadOnlyDictionary<string, RoomOrigin>>> Origins(string user, IReadOnlyList<string> selected, CancellationToken cancellation)
    {
        var response = await Request("GET", MatrixJson.Api + "/user/" + MatrixJson.Segment(user) + "/account_data/m.direct", null, cancellation);
        if (!response.IsSuccess && response.Error.Code != "missing") return Result<IReadOnlyDictionary<string, RoomOrigin>>.Fail(response.Error);
        var direct = response.IsSuccess ? response.Value : WireJson.Object(_ => { });
        if (direct.ValueKind != JsonValueKind.Object) return Results.Fail<IReadOnlyDictionary<string, RoomOrigin>>("native", "Invalid Matrix direct-message map");
        var privateRooms = new HashSet<string>(StringComparer.Ordinal);
        foreach (var person in direct.EnumerateObject())
        {
            if (!MatrixSyntax.UserId(person.Name) || person.Value.ValueKind != JsonValueKind.Array) return Results.Fail<IReadOnlyDictionary<string, RoomOrigin>>("native", "Invalid Matrix direct-message entry");
            foreach (var room in person.Value.EnumerateArray()) { if (room.ValueKind != JsonValueKind.String || !MatrixSyntax.RoomId(room.GetString()!)) return Results.Fail<IReadOnlyDictionary<string, RoomOrigin>>("native", "Invalid Matrix direct-message room"); privateRooms.Add(room.GetString()!); }
        }
        var result = new Dictionary<string, RoomOrigin>(StringComparer.Ordinal);
        foreach (var room in selected)
        {
            var state = await State(room, cancellation); if (!state.IsSuccess) return Result<IReadOnlyDictionary<string, RoomOrigin>>.Fail(state.Error);
            var parsed = RoomState.Parse(WireJson.Array(writer => { foreach (var value in state.Value) value.WriteTo(writer); })); if (!parsed.IsSuccess) return Result<IReadOnlyDictionary<string, RoomOrigin>>.Fail(parsed.Error);
            result[room] = new(privateRooms.Contains(room) ? "dm" : "room", RoomState.Content(parsed.Value, "m.room.name") is { } name ? WireJson.Text(name, "name") : null,
                RoomState.Content(parsed.Value, "m.room.canonical_alias") is { } alias ? WireJson.Text(alias, "alias") : null);
        }
        return Result<IReadOnlyDictionary<string, RoomOrigin>>.Success(result);
    }

    private async ValueTask<Result<Unit>> VerifyPrivateConversation(string room, string owner, string agent, CancellationToken cancellation)
    {
        var response = await Request("GET", Room(room) + "/state", null, cancellation);
        if (!response.IsSuccess) return Results.Fail<Unit>("unavailable", "Backend private conversation is unavailable");
        var state = RoomState.Parse(response.Value); if (!state.IsSuccess) return Result<Unit>.Fail(state.Error);
        var privacy = RoomState.OwnerConversation(state.Value, owner, agent); if (!privacy.IsSuccess) return privacy;
        if (new[] { owner, agent }.Any(identity => !state.Value.Any(value => value.Type == "m.room.member" && value.StateKey == identity && WireJson.Text(value.Content, "membership") == "join")))
            return Results.Fail<Unit>("forbidden", "Both participants must have joined the private conversation");
        var powers = RoomState.Powers(RoomState.Content(state.Value, "m.room.power_levels") ?? WireJson.Object(_ => { }), agent);
        return powers.IsSuccess && powers.Value.OwnerLevel >= powers.Value.Message ? Results.Done() : Results.Fail<Unit>("forbidden", "Agent cannot send to its owner");
    }
}
