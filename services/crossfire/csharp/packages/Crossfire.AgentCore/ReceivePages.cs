using System.Globalization;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public static class ReceivePages
{
    public static int RoomQuota(int limit, int rooms, int position) => Math.Max(limit == 100 ? 10 : 1, limit / Math.Max(1, rooms) + (position < limit % Math.Max(1, rooms) ? 1 : 0));
    public static async ValueTask<Result<IReadOnlySet<string>>> Joined(AgentMatrix matrix, CancellationToken cancellation)
    {
        var response = await AgentIO.Request(matrix, new("GET", AgentIO.MatrixApi + "/joined_rooms"), cancellation); if (!response.IsSuccess) return Result<IReadOnlySet<string>>.Fail(response.Error);
        if (response.Value.ValueKind != JsonValueKind.Object || !response.Value.TryGetProperty("joined_rooms", out var source)) return Results.Fail<IReadOnlySet<string>>("invalid", "Invalid native joined-room list");
        var parsed = Validation.List(source, value => Validation.Text(value).Bind(room => Validation.RoomId(room) ? Result<string>.Success(room) : Results.Fail<string>("invalid", "Invalid native room identity")), 1000);
        return !parsed.IsSuccess || parsed.Value.Distinct(StringComparer.Ordinal).Count() != parsed.Value.Count ? Results.Fail<IReadOnlySet<string>>("invalid", "Invalid or excessive joined-room list") : Result<IReadOnlySet<string>>.Success(parsed.Value.ToHashSet(StringComparer.Ordinal));
    }
    public static async ValueTask<Result<NativePage>> History(AgentMatrix matrix, string room, IReadOnlyDictionary<string, string> query, int requested, CancellationToken cancellation)
    {
        if (!Validation.RoomId(room) || requested is < 1 or > 100) return Results.Fail<NativePage>("invalid", "Invalid native history request"); var limit = requested;
        for (;;)
        {
            var values = new Dictionary<string, string>(query, StringComparer.Ordinal) { ["limit"] = limit.ToString(CultureInfo.InvariantCulture) };
            var response = await AgentIO.Request(matrix, new("GET", AgentIO.MatrixApi + "/rooms/" + AgentIO.Segment(room) + "/messages", Query: values, MaximumBytes: limit == 1 ? AgentIO.HistoryBytes : 1048576), cancellation);
            if (!response.IsSuccess)
            {
                if (response.Error.Code != "body_too_large") return Result<NativePage>.Fail(response.Error);
                if (limit == 1) return Results.Fail<NativePage>("limit", "A single native event exceeds the 64 MiB collection bound; unread positions are unchanged"); limit = Math.Max(1, limit / 2); continue;
            }
            var body = response.Value; if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("chunk", out var chunk) || chunk.ValueKind != JsonValueKind.Array || chunk.GetArrayLength() > limit
                || body.TryGetProperty("start", out var start) && start.ValueKind != JsonValueKind.String || body.TryGetProperty("end", out var end) && end.ValueKind != JsonValueKind.String)
                return Results.Fail<NativePage>("invalid", "Invalid native Matrix history page");
            var continuation = WireJson.Text(body, "end"); if (chunk.GetArrayLength() != 0 && (string.IsNullOrEmpty(continuation) || query.TryGetValue("from", out var from) && continuation == from)) return Results.Fail<NativePage>("invalid", "Matrix history cursor did not advance");
            return Result<NativePage>.Success(new(chunk.EnumerateArray().Select(value => value.Clone()).ToArray(), WireJson.Text(body, "start"), continuation, limit));
        }
    }
    public static async ValueTask<Result<JsonElement>> Sync(AgentMatrix matrix, string? since, int timeout, CancellationToken cancellation)
    {
        var limit = 100;
        for (;;)
        {
            var filter = WireJson.Object(writer =>
            {
                writer.WriteStartObject("presence"); writer.WriteStartArray("types"); writer.WriteEndArray(); writer.WriteEndObject(); writer.WriteStartObject("account_data"); writer.WriteStartArray("types"); writer.WriteEndArray(); writer.WriteEndObject();
                writer.WriteStartObject("room"); writer.WriteStartObject("timeline"); writer.WriteNumber("limit", limit); writer.WriteStartArray("types"); foreach (var type in ReceivedEvents.Important) writer.WriteStringValue(type); writer.WriteEndArray(); writer.WriteEndObject();
                writer.WriteStartObject("state"); writer.WriteStartArray("types"); writer.WriteStringValue("m.room.member"); writer.WriteEndArray(); writer.WriteEndObject(); writer.WriteStartObject("ephemeral"); writer.WriteStartArray("types"); writer.WriteEndArray(); writer.WriteEndObject();
                writer.WriteStartObject("account_data"); writer.WriteStartArray("types"); writer.WriteStringValue("m.fully_read"); writer.WriteStringValue("m.marked_unread"); writer.WriteEndArray(); writer.WriteEndObject(); writer.WriteEndObject();
            });
            var query = new Dictionary<string, string>(StringComparer.Ordinal) { ["timeout"] = timeout.ToString(CultureInfo.InvariantCulture), ["filter"] = WireJson.Compact(filter) }; if (since is not null) query["since"] = since;
            var result = await AgentIO.Request(matrix, new("GET", AgentIO.MatrixApi + "/sync", Query: query, MaximumBytes: limit <= 1 ? AgentIO.HistoryBytes : 1048576), cancellation);
            if (result.IsSuccess) return WireJson.Text(result.Value, "next_batch") is { Length: > 0 } ? result : Results.Fail<JsonElement>("invalid", "Matrix sync has no continuation");
            if (result.Error.Code != "body_too_large") return result; if (limit == 0) return Results.Fail<JsonElement>("limit", "Native sync state exceeds its collection bound; unread positions are unchanged"); limit /= 2;
        }
    }
    public static async ValueTask<Result<IReadOnlyList<ReceivedEvent>>> Origins(AgentMatrix matrix, string self, IReadOnlyList<ReceivedEvent> events, CancellationToken cancellation)
    {
        var direct = await AgentIO.Request(matrix, new("GET", AgentIO.MatrixApi + "/user/" + AgentIO.Segment(self) + "/account_data/m.direct"), cancellation);
        if (!direct.IsSuccess && direct.Error.Code != "missing") return Result<IReadOnlyList<ReceivedEvent>>.Fail(direct.Error);
        var privateRooms = new HashSet<string>(StringComparer.Ordinal);
        if (direct.IsSuccess)
        {
            if (direct.Value.ValueKind != JsonValueKind.Object) return Results.Fail<IReadOnlyList<ReceivedEvent>>("invalid", "Invalid native direct-message map");
            foreach (var field in direct.Value.EnumerateObject())
            {
                if (!Validation.UserId(field.Name) || field.Value.ValueKind != JsonValueKind.Array || field.Value.EnumerateArray().Any(room => room.ValueKind != JsonValueKind.String || !Validation.RoomId(room.GetString()!))) return Results.Fail<IReadOnlyList<ReceivedEvent>>("invalid", "Invalid native direct-message entry");
                foreach (var room in field.Value.EnumerateArray()) privateRooms.Add(room.GetString()!);
            }
        }
        var origins = new Dictionary<string, AgentOrigin>(StringComparer.Ordinal);
        foreach (var room in events.Select(value => value.RoomId).Distinct(StringComparer.Ordinal))
        {
            var state = await AgentIO.Request(matrix, new("GET", AgentIO.MatrixApi + "/rooms/" + AgentIO.Segment(room) + "/state"), cancellation); if (!state.IsSuccess) return Result<IReadOnlyList<ReceivedEvent>>.Fail(state.Error);
            var parsed = RoomState.Parse(state.Value); if (!parsed.IsSuccess) return Result<IReadOnlyList<ReceivedEvent>>.Fail(parsed.Error);
            var name = parsed.Value.FirstOrDefault(value => value.Type == "m.room.name"); var alias = parsed.Value.FirstOrDefault(value => value.Type == "m.room.canonical_alias");
            origins[room] = new(privateRooms.Contains(room) ? "dm" : "room", name is null ? null : WireJson.Text(name.Content, "name"), alias is null ? null : WireJson.Text(alias.Content, "alias"));
        }
        return Result<IReadOnlyList<ReceivedEvent>>.Success(events.Select(value => value with { Origin = origins[value.RoomId] }).ToArray());
    }
}
