using System.Runtime.CompilerServices;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public static class SyncEvents
{
    public static JsonElement? Section(JsonElement sync, string section)
        => sync.ValueKind == JsonValueKind.Object && sync.TryGetProperty("rooms", out var rooms) && rooms.ValueKind == JsonValueKind.Object && rooms.TryGetProperty(section, out var value) && value.ValueKind == JsonValueKind.Object ? value : null;
    public static IReadOnlyList<JsonElement> Events(JsonElement value, string section)
    { if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty(section, out var data) || data.ValueKind != JsonValueKind.Object || !data.TryGetProperty("events", out var events)) return []; return events.ValueKind == JsonValueKind.Array ? events.EnumerateArray().Select(item => item.Clone()).ToArray() : throw new InvalidDataException("Invalid native sync events"); }
    public static async IAsyncEnumerable<Result<JsonElement>> Incremental(AgentMatrix matrix, JsonElement sync, string since, string room, JsonElement filter, [EnumeratorCancellation] CancellationToken cancellation)
    {
        var joined = Section(sync, "join"); if (joined is null || !joined.Value.TryGetProperty(room, out var data) || !data.TryGetProperty("timeline", out var timeline) || timeline.ValueKind != JsonValueKind.Object) yield break;
        var tail = Events(data, "timeline"); var limited = timeline.TryGetProperty("limited", out var flag) && flag.ValueKind == JsonValueKind.True;
        if (!limited) { foreach (var value in tail) if (!ReceivedEvents.Notice(value)) yield return Result<JsonElement>.Success(value); yield break; }
        var nextBatch = WireJson.Text(sync, "next_batch"); if (nextBatch is null) { yield return Results.Fail<JsonElement>("invalid", "Missing native sync continuation"); yield break; }
        var from = since; var recovered = new HashSet<string>(StringComparer.Ordinal); var tailIds = tail.Select(value => WireJson.Text(value, "event_id")).Where(value => value is not null).ToHashSet(StringComparer.Ordinal); var visited = new HashSet<string>(StringComparer.Ordinal);
        for (;;)
        {
            var query = new Dictionary<string, string>(StringComparer.Ordinal) { ["from"] = from, ["to"] = nextBatch, ["dir"] = "f", ["filter"] = WireJson.Compact(filter) };
            var page = await ReceivePages.History(matrix, room, query, 100, cancellation); if (!page.IsSuccess) { yield return Result<JsonElement>.Fail(page.Error); yield break; }
            foreach (var value in page.Value.Chunk) { var id = WireJson.Text(value, "event_id"); if (id is not null && tailIds.Contains(id)) recovered.Add(id); if (!ReceivedEvents.Notice(value)) yield return Result<JsonElement>.Success(value); }
            if (page.Value.Chunk.Count == 0 || page.Value.End == nextBatch) break;
            if (page.Value.End is not { } end || end == from || !visited.Add(end)) { yield return Results.Fail<JsonElement>("invalid", "Incremental native history cursor did not advance"); yield break; } from = end;
        }
        foreach (var value in tail) if (!ReceivedEvents.Notice(value) && !recovered.Contains(WireJson.Text(value, "event_id") ?? "")) yield return Result<JsonElement>.Success(value);
    }
    public static async ValueTask<Result<IReadOnlySet<string>>> MembershipResets(AgentMatrix matrix, JsonElement sync, AgentAccount account, string? since, CancellationToken cancellation)
    {
        var reset = Section(sync, "leave")?.EnumerateObject().Select(field => field.Name).ToHashSet(StringComparer.Ordinal) ?? new HashSet<string>(StringComparer.Ordinal); if (since is null) return Result<IReadOnlySet<string>>.Success(reset);
        var joined = Section(sync, "join"); if (joined is null) return Result<IReadOnlySet<string>>.Success(reset);
        bool Own(JsonElement value) => WireJson.Text(value, "type") == "m.room.member" && WireJson.Text(value, "state_key") == account.UserId;
        bool Changed(JsonElement value)
        {
            if (!Own(value) || !value.TryGetProperty("content", out var content)) return false; var membership = WireJson.Text(content, "membership");
            return membership is "leave" or "ban" || membership == "join" && value.TryGetProperty("unsigned", out var unsigned) && unsigned.ValueKind == JsonValueKind.Object && unsigned.TryGetProperty("prev_content", out var previous) && WireJson.Text(previous, "membership") is "leave" or "ban" or "invite" or "knock";
        }
        foreach (var room in joined.Value.EnumerateObject())
        {
            if (!Validation.RoomId(room.Name)) return Results.Fail<IReadOnlySet<string>>("invalid", "Invalid native membership room"); var state = Events(room.Value, "state"); var timeline = Events(room.Value, "timeline"); if (!state.Concat(timeline).Any(Own)) continue;
            if (state.Any(Changed)) reset.Add(room.Name);
            var filter = WireJson.Object(writer => { writer.WriteStartArray("types"); writer.WriteStringValue("m.room.member"); writer.WriteEndArray(); });
            await foreach (var value in Incremental(matrix, sync, since, room.Name, filter, cancellation)) { if (!value.IsSuccess) return Result<IReadOnlySet<string>>.Fail(value.Error); if (Changed(value.Value)) reset.Add(room.Name); }
        }
        return Result<IReadOnlySet<string>>.Success(reset);
    }
    public static void RetainJoined(LocalState storage, string file, IReadOnlySet<string> joined)
    {
        if (!storage.Exists(file)) return; var current = ReceiveState.Load(storage, file); var retained = ReceiveState.Filter(current, joined); if (current.Count == retained.Count) return;
        if (storage.Exists(file + ".ack")) { var pending = AgentIO.Read(storage, file + ".ack"); var receipts = ReceiveState.Cursors(pending.GetProperty("receipts")); if (!receipts.IsSuccess) throw new InvalidDataException(receipts.Error.Message);
            AgentIO.Write(storage, file + ".ack", WireJson.Object(writer => { writer.WritePropertyName("cursors"); ReceiveState.Encode(retained).WriteTo(writer); writer.WritePropertyName("receipts"); ReceiveState.Encode(ReceiveState.Filter(receipts.Value, joined)).WriteTo(writer); })); }
        AgentIO.Write(storage, file, ReceiveState.Encode(retained));
    }
}
