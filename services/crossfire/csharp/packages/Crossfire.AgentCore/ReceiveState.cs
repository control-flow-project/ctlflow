using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public static class ReceiveState
{
    public static Result<IReadOnlyDictionary<string, string>> Cursors(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() > 1000) return Results.Fail<IReadOnlyDictionary<string, string>>("invalid", "Invalid retained Matrix cursors");
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var field in value.EnumerateObject())
        { var cursor = Validation.Text(field.Value, 4096); if (!Validation.RoomId(field.Name) || !cursor.IsSuccess || !result.TryAdd(field.Name, cursor.Value)) return Results.Fail<IReadOnlyDictionary<string, string>>("invalid", "Invalid retained Matrix continuation"); }
        return Result<IReadOnlyDictionary<string, string>>.Success(result);
    }
    public static IReadOnlyDictionary<string, string> Load(LocalState storage, string file)
    { if (!storage.Exists(file)) return new Dictionary<string, string>(StringComparer.Ordinal); var result = Cursors(AgentIO.Read(storage, file)); return result.IsSuccess ? result.Value : throw new InvalidDataException(result.Error.Message); }
    public static JsonElement Encode(IReadOnlyDictionary<string, string> values) => WireJson.Object(writer => { foreach (var field in values) writer.WriteString(field.Key, field.Value); });
    public static JsonElement Encode(ReadBatch batch) => WireJson.Object(writer =>
    {
        writer.WriteStartArray("events"); foreach (var value in batch.Events) ReceivedEvents.Encode(value).WriteTo(writer); writer.WriteEndArray(); writer.WritePropertyName("cursors"); Encode(batch.Cursors).WriteTo(writer);
        writer.WriteStartArray("more_rooms"); foreach (var room in batch.MoreRooms) writer.WriteStringValue(room); writer.WriteEndArray(); writer.WritePropertyName("latest"); Encode(batch.Latest).WriteTo(writer);
    });
    public static Result<ReadBatch> Decode(JsonElement value)
    {
        if (!Validation.Fields(value, ["events", "cursors", "more_rooms", "latest"]).IsSuccess) return Results.Fail<ReadBatch>("invalid", "Invalid retained Matrix batch");
        var events = Validation.List(value.GetProperty("events"), ReceivedEvents.Decode, 100000); var cursors = Cursors(value.GetProperty("cursors")); var latest = Cursors(value.GetProperty("latest"));
        var more = Validation.List(value.GetProperty("more_rooms"), text => Validation.Text(text).Bind(room => Validation.RoomId(room) ? Result<string>.Success(room) : Results.Fail<string>("invalid", "Invalid retained room")), 1000);
        return !events.IsSuccess || !cursors.IsSuccess || !latest.IsSuccess || !more.IsSuccess ? Results.Fail<ReadBatch>("invalid", "Invalid retained Matrix batch") : Result<ReadBatch>.Success(new(events.Value, cursors.Value, more.Value, latest.Value));
    }
    public static string? SyncCursor(LocalState storage, string file)
    {
        if (!storage.Exists(file + ".sync")) return null; var parsed = Validation.Text(AgentIO.Read(storage, file + ".sync"), 4096);
        return parsed.IsSuccess ? parsed.Value : throw new InvalidDataException("Invalid saved Matrix sync cursor");
    }
    public static void CheckpointSync(LocalState storage, string file, string since)
    { if (since.Length == 0) throw new InvalidDataException("Missing Matrix continuation"); if (SyncCursor(storage, file) != since) AgentIO.Write(storage, file + ".sync", WireJson.Build(writer => writer.WriteStringValue(since))); }
    public static bool Same(IReadOnlyDictionary<string, string> first, IReadOnlyDictionary<string, string> second)
        => first.Count == second.Count && first.All(value => second.TryGetValue(value.Key, out var other) && other == value.Value);
    public static async ValueTask<Result<Unit>> Acknowledge(LocalState storage, AgentMatrix matrix, string file, ReadBatch batch, CancellationToken cancellation)
    {
        var receipts = batch.Latest.Where(value => batch.Events.Any(item => item.RoomId == value.Key && item.EventId == value.Value)).ToDictionary(value => value.Key, value => value.Value, StringComparer.Ordinal);
        if (storage.Exists(file) && Same(Load(storage, file), batch.Cursors) && receipts.Count == 0) return Results.Done();
        AgentIO.Write(storage, file + ".ack", WireJson.Object(writer => { writer.WritePropertyName("cursors"); Encode(batch.Cursors).WriteTo(writer); writer.WritePropertyName("receipts"); Encode(receipts).WriteTo(writer); }));
        return await Flush(storage, matrix, file, cancellation);
    }
    public static async ValueTask<Result<Unit>> Flush(LocalState storage, AgentMatrix matrix, string file, CancellationToken cancellation)
    {
        if (!storage.Exists(file + ".ack")) return Results.Done(); var pending = AgentIO.Read(storage, file + ".ack");
        if (!Validation.Fields(pending, ["cursors", "receipts"]).IsSuccess) return Results.Fail<Unit>("invalid", "Invalid receive acknowledgement");
        var cursors = Cursors(pending.GetProperty("cursors")); var receipts = Cursors(pending.GetProperty("receipts")); if (!cursors.IsSuccess || !receipts.IsSuccess) return Results.Fail<Unit>("invalid", "Invalid receive acknowledgement continuations");
        if (storage.Exists(file + ".snapshot"))
        {
            var snapshot = AgentIO.Read(storage, file + ".snapshot", AgentIO.HistoryBytes); var original = Cursors(snapshot.GetProperty("base")); var batch = Decode(snapshot.GetProperty("batch"));
            if (!original.IsSuccess || !batch.IsSuccess) return Results.Fail<Unit>("invalid", "Invalid pinned delivery snapshot");
            var remaining = batch.Value.Cursors.Keys.Where(room => !original.Value.ContainsKey(room) && !cursors.Value.ContainsKey(room) && !receipts.Value.ContainsKey(room)).ToHashSet(StringComparer.Ordinal);
            if (remaining.Count == 0) storage.Remove(file + ".snapshot");
            else
            {
                var retained = batch.Value with { Events = batch.Value.Events.Where(value => remaining.Contains(value.RoomId)).ToArray(), Cursors = Filter(batch.Value.Cursors, remaining), Latest = Filter(batch.Value.Latest, remaining), MoreRooms = batch.Value.MoreRooms.Where(remaining.Contains).ToArray() };
                AgentIO.Write(storage, file + ".snapshot", WireJson.Object(writer => { writer.WritePropertyName("base"); Encode(cursors.Value).WriteTo(writer); writer.WritePropertyName("batch"); Encode(retained).WriteTo(writer); }), AgentIO.HistoryBytes);
            }
        }
        AgentIO.Write(storage, file, Encode(cursors.Value)); var joined = await ReceivePages.Joined(matrix, cancellation); if (!joined.IsSuccess) return Result<Unit>.Fail(joined.Error);
        foreach (var receipt in receipts.Value)
        {
            if (!joined.Value.Contains(receipt.Key)) continue;
            var body = WireJson.Object(writer => { writer.WriteString("m.fully_read", receipt.Value); writer.WriteString("m.read.private", receipt.Value); });
            var sent = await AgentIO.Request(matrix, new("POST", AgentIO.MatrixApi + "/rooms/" + AgentIO.Segment(receipt.Key) + "/read_markers", body), cancellation); if (!sent.IsSuccess) return Result<Unit>.Fail(sent.Error);
        }
        storage.Remove(file + ".ack"); return Results.Done();
    }
    public static IReadOnlyDictionary<string, string> Filter(IReadOnlyDictionary<string, string> values, IReadOnlySet<string> rooms)
        => values.Where(value => rooms.Contains(value.Key)).ToDictionary(value => value.Key, value => value.Value, StringComparer.Ordinal);
}
