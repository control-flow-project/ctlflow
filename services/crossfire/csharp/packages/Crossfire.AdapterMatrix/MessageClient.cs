using System.Globalization;
using System.Text.Json;
using Crossfire.AdapterHttp;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public sealed partial class MessageClient(HttpClient http, NativeEndpoint endpoint, string self)
{
    private sealed record NativePage(IReadOnlyList<JsonElement> Events, string? Start, string? End, int Limit);
    private const int CollectionBytes = 67108864;
    private static string Room(string room) => MatrixJson.Api + "/rooms/" + MatrixJson.Segment(room);
    private static string Query(IReadOnlyDictionary<string, string> fields) => "?" + string.Join('&', fields.Select(field => MatrixJson.Segment(field.Key) + "=" + MatrixJson.Segment(field.Value)));
    private async ValueTask<Result<JsonElement>> Request(string method, string path, JsonElement? body, CancellationToken cancellation, int maximum = NativeHttp.MaxJsonBytes)
    {
        var response = await NativeHttp.Json(http, endpoint, method, path, body, maximum, cancellation);
        if (!response.IsSuccess) return Result<JsonElement>.Fail(response.Error);
        using var received = response.Value;
        if (received.Status is < 200 or >= 300) return Results.Fail<JsonElement>(received.Status switch
        { 401 => "unauthorized", 403 => "forbidden", 404 => "missing", 409 => "conflict", 429 => "rate_limit", >= 500 => "unavailable", _ => "invalid" }, "Matrix request failed: HTTP " + received.Status);
        return Result<JsonElement>.Success(received.Body.Clone());
    }

    public MessagingClient Ports() => new(Identify, JoinedRooms, JoinedMembers, Synchronize, History, Event, State, Origins,
        Acknowledge, SendNotice, Thinking, VerifyPrivateConversation, MatrixNotices.Fits, MatrixNotices.Chunks);

    private async ValueTask<Result<string>> Identify(CancellationToken cancellation)
    {
        var result = await Request("GET", MatrixJson.Api + "/account/whoami", null, cancellation);
        if (!result.IsSuccess) return Result<string>.Fail(result.Error);
        var user = WireJson.Text(result.Value, "user_id");
        return user is not null && MatrixSyntax.UserId(user) ? Result<string>.Success(user) : Results.Fail<string>("native", "Invalid Matrix authenticated identity");
    }

    private async ValueTask<Result<IReadOnlySet<string>>> JoinedRooms(CancellationToken cancellation)
    {
        var result = await Request("GET", MatrixJson.Api + "/joined_rooms", null, cancellation);
        if (!result.IsSuccess) return Result<IReadOnlySet<string>>.Fail(result.Error);
        if (!result.Value.TryGetProperty("joined_rooms", out var rooms)) return Results.Fail<IReadOnlySet<string>>("native", "Invalid Matrix joined-room list");
        var parsed = Validation.List(rooms, value => Validation.Text(value).Bind(room => MatrixSyntax.RoomId(room) ? Result<string>.Success(room) : Results.Fail<string>("native", "Invalid Matrix room")), 1000);
        if (!parsed.IsSuccess || parsed.Value.Distinct(StringComparer.Ordinal).Count() != parsed.Value.Count) return Results.Fail<IReadOnlySet<string>>("native", "Invalid or excessive Matrix joined-room list");
        return Result<IReadOnlySet<string>>.Success(parsed.Value.ToHashSet(StringComparer.Ordinal));
    }

    private async ValueTask<Result<IReadOnlySet<string>>> JoinedMembers(string room, CancellationToken cancellation)
    {
        var result = await Request("GET", Room(room) + "/joined_members", null, cancellation);
        if (!result.IsSuccess) return Result<IReadOnlySet<string>>.Fail(result.Error);
        if (!result.Value.TryGetProperty("joined", out var joined) || joined.ValueKind != JsonValueKind.Object || joined.EnumerateObject().Any(field => !MatrixSyntax.UserId(field.Name)))
            return Results.Fail<IReadOnlySet<string>>("native", "Invalid Matrix joined-member list");
        return Result<IReadOnlySet<string>>.Success(joined.EnumerateObject().Select(field => field.Name).ToHashSet(StringComparer.Ordinal));
    }

    private static Result<IReadOnlyList<MessageEvent>> Events(JsonElement value, string room)
    {
        if (value.ValueKind != JsonValueKind.Array) return Results.Fail<IReadOnlyList<MessageEvent>>("native", "Invalid Matrix event collection");
        var events = new List<MessageEvent>();
        foreach (var item in value.EnumerateArray()) { var parsed = MessageEvents.Parse(item, room); if (!parsed.IsSuccess) return Result<IReadOnlyList<MessageEvent>>.Fail(parsed.Error); events.Add(parsed.Value); }
        return Result<IReadOnlyList<MessageEvent>>.Success(events);
    }

    private async ValueTask<Result<MessagePage>> History(string room, MessagePageRequest request, CancellationToken cancellation)
    {
        var native = await ReadHistory(room, request, cancellation);
        if (!native.IsSuccess) return Result<MessagePage>.Fail(native.Error);
        var events = new List<MessageEvent>();
        foreach (var value in native.Value.Events) { var parsed = MessageEvents.Parse(value, room); if (!parsed.IsSuccess) return Result<MessagePage>.Fail(parsed.Error); events.Add(parsed.Value); }
        return Result<MessagePage>.Success(new(events, native.Value.Start, native.Value.End, native.Value.Limit));
    }

    private async ValueTask<Result<NativePage>> ReadHistory(string room, MessagePageRequest request, CancellationToken cancellation)
    {
        if (!MatrixSyntax.RoomId(room) || request.Limit is < 1 or > 100 || request.Direction is not ("forward" or "backward")) return Results.Fail<NativePage>("invalid", "Invalid Matrix history request");
        var limit = request.Limit;
        for (;;)
        {
            var query = new Dictionary<string, string> { ["dir"] = request.Direction == "forward" ? "f" : "b", ["limit"] = limit.ToString(CultureInfo.InvariantCulture) };
            if (request.From is not null) query["from"] = request.From; if (request.To is not null) query["to"] = request.To;
            if (request.Filter is { } filter)
            {
                if (filter.Types?.Contains("other", StringComparer.Ordinal) == true) return Results.Fail<NativePage>("invalid", "Matrix filtering cannot request an exhaustive unknown-event category");
                query["filter"] = WireJson.Compact(WireJson.Object(writer =>
                {
                    if (filter.Types is not null) { writer.WriteStartArray("types"); foreach (var pair in MessageEvents.Types.Where(pair => filter.Types.Contains(pair.Value, StringComparer.Ordinal))) writer.WriteStringValue(pair.Key); writer.WriteEndArray(); }
                    if (filter.Senders is not null) { writer.WriteStartArray("senders"); foreach (var sender in filter.Senders) writer.WriteStringValue(sender); writer.WriteEndArray(); }
                }));
            }
            var result = await Request("GET", Room(room) + "/messages" + Query(query), null, cancellation, limit == 1 ? CollectionBytes : NativeHttp.MaxJsonBytes);
            if (!result.IsSuccess)
            {
                if (result.Error.Code != "body_too_large") return Result<NativePage>.Fail(result.Error);
                if (limit == 1) return Results.Fail<NativePage>("limit", "A Matrix history event exceeds the collection resource bound; unread positions are unchanged");
                limit = Math.Max(1, limit / 2); continue;
            }
            var value = result.Value;
            if (!value.TryGetProperty("chunk", out var chunk)) return Results.Fail<NativePage>("native", "Invalid Matrix message page");
            var parsed = Events(chunk, room); var start = WireJson.Text(value, "start"); var end = WireJson.Text(value, "end");
            if (!parsed.IsSuccess) return Result<NativePage>.Fail(parsed.Error);
            if (parsed.Value.Count > limit || value.TryGetProperty("start", out var first) && first.ValueKind != JsonValueKind.String
                || value.TryGetProperty("end", out var last) && last.ValueKind != JsonValueKind.String || parsed.Value.Count > 0 && (string.IsNullOrEmpty(end) || end == request.From))
                return Results.Fail<NativePage>("native", "Invalid or nonadvancing Matrix message page");
            return Result<NativePage>.Success(new(chunk.EnumerateArray().Select(item => item.Clone()).ToArray(), start, end, limit));
        }
    }

    private async ValueTask<Result<MessageEvent>> Event(string room, string id, CancellationToken cancellation)
    {
        if (!MatrixSyntax.EventId(id)) return Results.Fail<MessageEvent>("invalid", "Invalid Matrix event identity");
        var result = await Request("GET", Room(room) + "/event/" + MatrixJson.Segment(id), null, cancellation);
        if (!result.IsSuccess) return Result<MessageEvent>.Fail(result.Error);
        var parsed = MessageEvents.Parse(result.Value, room);
        return parsed.IsSuccess && parsed.Value.EventId != id ? Results.Fail<MessageEvent>("native", "Matrix event identity changed") : parsed;
    }

    private async ValueTask<Result<IReadOnlyList<JsonElement>>> State(string room, CancellationToken cancellation)
    {
        var result = await Request("GET", Room(room) + "/state", null, cancellation, CollectionBytes);
        if (!result.IsSuccess) return Result<IReadOnlyList<JsonElement>>.Fail(result.Error);
        var parsed = RoomState.Parse(result.Value);
        return parsed.IsSuccess ? Result<IReadOnlyList<JsonElement>>.Success(result.Value.EnumerateArray().Select(value => value.Clone()).ToArray()) : Result<IReadOnlyList<JsonElement>>.Fail(parsed.Error);
    }

    private async ValueTask<Result<Unit>> Acknowledge(string room, string id, CancellationToken cancellation)
        => (await Request("POST", Room(room) + "/read_markers", WireJson.Object(writer => { writer.WriteString("m.fully_read", id); writer.WriteString("m.read.private", id); }), cancellation)).Map(_ => default(Unit));
    private async ValueTask<Result<Unit>> SendNotice(string room, string transaction, string body, CancellationToken cancellation)
        => (await Request("PUT", Room(room) + "/send/m.room.message/" + MatrixJson.Segment(transaction), MatrixNotices.Content(body), cancellation)).Map(_ => default(Unit));
    private async ValueTask<Result<Unit>> Thinking(string room, string user, bool enabled, int timeout, CancellationToken cancellation)
        => (await Request("PUT", Room(room) + "/typing/" + MatrixJson.Segment(user), WireJson.Object(writer => { writer.WriteBoolean("typing", enabled); if (enabled) writer.WriteNumber("timeout", timeout); }), cancellation)).Map(_ => default(Unit));
}
