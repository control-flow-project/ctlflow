using Crossfire.Domain;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed record WakeCycle(IReadOnlyDictionary<string, HistoryEnd> Ends, string Sender, string Room);
public static class ReceiveSnapshots
{
    private static (IReadOnlyDictionary<string, string> Base, ReadBatch Batch) Snapshot(LocalState storage, string file)
    {
        var value = AgentIO.Read(storage, file + ".snapshot", AgentIO.HistoryBytes); if (!Validation.Fields(value, ["base", "batch"]).IsSuccess) throw new InvalidDataException("Invalid pinned delivery snapshot");
        var original = ReceiveState.Cursors(value.GetProperty("base")); var batch = ReceiveState.Decode(value.GetProperty("batch")); if (!original.IsSuccess || !batch.IsSuccess) throw new InvalidDataException("Invalid pinned delivery snapshot"); return (original.Value, batch.Value);
    }
    private static void Save(LocalState storage, string file, IReadOnlyDictionary<string, string> original, ReadBatch batch)
        => AgentIO.Write(storage, file + ".snapshot", WireJson.Object(writer => { writer.WritePropertyName("base"); ReceiveState.Encode(original).WriteTo(writer); writer.WritePropertyName("batch"); ReceiveState.Encode(batch).WriteTo(writer); }), AgentIO.HistoryBytes);
    public static WakeCycle? LoadWake(LocalState storage, string file)
    {
        if (!storage.Exists(file + ".wake")) return null; var value = AgentIO.Read(storage, file + ".wake", AgentIO.HistoryBytes);
        if (!Validation.Fields(value, ["ends", "sender", "room"]).IsSuccess || value.GetProperty("ends").ValueKind != JsonValueKind.Object) throw new InvalidDataException("Invalid saved wake cycle");
        var sender = WireJson.Text(value, "sender"); var room = WireJson.Text(value, "room"); if (sender is null || !Validation.UserId(sender) || room is null || !Validation.RoomId(room)) throw new InvalidDataException("Invalid saved wake authority"); var ends = new Dictionary<string, HistoryEnd>(StringComparer.Ordinal);
        foreach (var field in value.GetProperty("ends").EnumerateObject())
        {
            if (ends.Count >= 1000 || !Validation.RoomId(field.Name) || !Validation.Fields(field.Value, ["cursor", "event"]).IsSuccess || WireJson.Text(field.Value, "cursor") is not { Length: > 0 } cursor) throw new InvalidDataException("Invalid saved wake boundary");
            var encoded = field.Value.GetProperty("event"); MessageEvent? native = null; if (encoded.ValueKind != JsonValueKind.Null) { var parsed = MessageCodec.Event(encoded); if (!parsed.IsSuccess || !ReceivedEvents.View(parsed.Value, field.Name).IsSuccess) throw new InvalidDataException("Invalid saved wake event"); native = parsed.Value; } ends.Add(field.Name, new(cursor, native));
        }
        return new(ends, sender, room);
    }
    public static void SaveWake(LocalState storage, string file, WakeCycle? value)
    {
        if (value is null) { AgentIO.Remove(storage, file + ".wake"); return; }
        AgentIO.Write(storage, file + ".wake", WireJson.Object(writer => { writer.WriteStartObject("ends"); foreach (var field in value.Ends) { writer.WriteStartObject(field.Key); writer.WriteString("cursor", field.Value.Cursor); writer.WritePropertyName("event"); if (field.Value.Event is { } native) MessageJson.Event(native).WriteTo(writer); else writer.WriteNullValue(); writer.WriteEndObject(); } writer.WriteEndObject(); writer.WriteString("sender", value.Sender); writer.WriteString("room", value.Room); }), AgentIO.HistoryBytes);
    }
    public static void Retire(LocalState storage, string file, IReadOnlySet<string> rooms)
    {
        if (!storage.Exists(file + ".snapshot")) return; var saved = Snapshot(storage, file); var retained = saved.Batch.Cursors.Keys.Where(room => !rooms.Contains(room)).ToHashSet(StringComparer.Ordinal); var original = ReceiveState.Filter(saved.Base, retained);
        var batch = saved.Batch with { Events = saved.Batch.Events.Where(value => !rooms.Contains(value.RoomId)).ToArray(), Cursors = ReceiveState.Filter(saved.Batch.Cursors, retained), Latest = ReceiveState.Filter(saved.Batch.Latest, retained), MoreRooms = saved.Batch.MoreRooms.Where(retained.Contains).ToArray() };
        if (batch.Cursors.Keys.Any(room => !original.ContainsKey(room))) Save(storage, file, original, batch); else AgentIO.Remove(storage, file + ".snapshot");
    }
    public static IReadOnlyList<string> ContentFiles(LocalState storage, string file) => !storage.Exists(file + ".snapshot") ? [] : Snapshot(storage, file).Batch.Events.Where(value => value.ContentFile is not null).Select(value => value.ContentFile!.File).ToArray();
    public static ValueTask<Result<ReadBatch>> Pending(LocalState storage, MessagingClient messaging, ClientSettings settings, string file, int limit, string? selected, int maximum, string? boundary, IReadOnlySet<string> allowed, WakeCycle? cycle, MessageArtifacts artifacts, CancellationToken cancellation)
        => AgentIO.Boundary(async () =>
        {
            var original = ReceiveState.Load(storage, file);
            if (storage.Exists(file + ".snapshot"))
            {
                var saved = Snapshot(storage, file);
                if (ReceiveState.Same(saved.Base, original))
                {
                    bool Included(string room) => allowed.Contains(room) && (selected is null || room == selected);
                    if (cycle is null)
                    {
                        var joined = await ReceivePages.Joined(messaging, cancellation); if (!joined.IsSuccess) return Result<ReadBatch>.Fail(joined.Error);
                        var added = joined.Value.Where(room => Included(room) && !saved.Batch.Cursors.ContainsKey(room)).ToHashSet(StringComparer.Ordinal);
                        if (added.Count != 0)
                        {
                            var next = await UnreadMessages.Read(storage, messaging, settings, file, limit, maximum, selected, boundary, added, null, artifacts.Stage, cancellation); if (!next.IsSuccess) return next;
                            saved.Batch = new([.. saved.Batch.Events, .. next.Value.Events], Merge(saved.Batch.Cursors, ReceiveState.Filter(next.Value.Cursors, added)), saved.Batch.MoreRooms.Concat(next.Value.MoreRooms).Distinct(StringComparer.Ordinal).ToArray(), Merge(saved.Batch.Latest, next.Value.Latest)); Save(storage, file, original, saved.Batch);
                        }
                    }
                    var retained = saved.Batch.Cursors.Keys.Where(Included).ToHashSet(StringComparer.Ordinal);
                    return Result<ReadBatch>.Success(saved.Batch with { Events = saved.Batch.Events.Where(value => Included(value.RoomId)).ToArray(), Cursors = Merge(original, ReceiveState.Filter(saved.Batch.Cursors, retained)), Latest = ReceiveState.Filter(saved.Batch.Latest, retained), MoreRooms = saved.Batch.MoreRooms.Where(Included).ToArray() });
                }
                storage.Remove(file + ".snapshot");
            }
            var batch = await UnreadMessages.Read(storage, messaging, settings, file, limit, maximum, selected, boundary, allowed, cycle is null ? null : new(original, cycle.Ends), artifacts.Stage, cancellation); if (!batch.IsSuccess) return batch;
            if (batch.Value.Cursors.Keys.Any(room => !original.ContainsKey(room))) Save(storage, file, original, batch.Value); return batch;
        });
    public static IReadOnlyDictionary<string, string> Merge(IReadOnlyDictionary<string, string> first, IReadOnlyDictionary<string, string> second)
    { var output = new Dictionary<string, string>(first, StringComparer.Ordinal); foreach (var field in second) output[field.Key] = field.Value; return output; }
    public static async ValueTask<Result<WakeCycle>> Capture(MessagingClient messaging, ReceivedEvent trigger, IReadOnlySet<string> rooms, string boundary, CancellationToken cancellation)
    {
        var ends = new Dictionary<string, HistoryEnd>(StringComparer.Ordinal);
        foreach (var room in rooms.Order(StringComparer.Ordinal))
        { var page = await ReceivePages.History(messaging, room, new("backward", 1), cancellation); if (!page.IsSuccess) return Result<WakeCycle>.Fail(page.Error); var native = page.Value.Events.Count == 0 ? null : page.Value.Events[0]; if (native is not null && !ReceivedEvents.View(native, room).IsSuccess) return Results.Fail<WakeCycle>("invalid", "Invalid wake boundary event"); ends.Add(room, new(page.Value.End ?? boundary, native)); }
        return Result<WakeCycle>.Success(new(ends, trigger.Sender, trigger.RoomId));
    }
    public static async ValueTask<Result<ReceivedEvent?>> Wake(MessagingClient messaging, ReadBatch batch, IReadOnlySet<string> senders, IReadOnlySet<string> allowed, string? selected, Func<ReceivedEvent, bool> accept, CancellationToken cancellation)
    {
        foreach (var value in batch.Events) if (value.Type == "message" && senders.Contains(value.Sender) && accept(value)) return Result<ReceivedEvent?>.Success(value);
        var identities = senders.ToArray();
        foreach (var room in allowed.Where(room => selected is null || room == selected).Order(StringComparer.Ordinal))
        {
            if (!batch.Cursors.TryGetValue(room, out var initial)) continue;
            for (var offset = 0; offset < identities.Length; offset += 50)
            {
                var from = initial; var visited = new HashSet<string>(StringComparer.Ordinal); var filter = new EventFilter(["message"], identities.Skip(offset).Take(50).ToArray());
                for (;;)
                {
                    var page = await ReceivePages.History(messaging, room, new("forward", 100, from, Filter: filter), cancellation); if (!page.IsSuccess) return Result<ReceivedEvent?>.Fail(page.Error);
                    foreach (var native in page.Value.Events) { var value = ReceivedEvents.View(native, room); if (!value.IsSuccess) return Result<ReceivedEvent?>.Fail(value.Error); if (value.Value.Type == "message" && senders.Contains(value.Value.Sender) && accept(value.Value)) return Result<ReceivedEvent?>.Success(value.Value); }
                    if (page.Value.Events.Count == 0) break; if (page.Value.End is not { } end || !visited.Add(end)) return Results.Fail<ReceivedEvent?>("invalid", "Wake history cursor did not advance"); from = end;
                }
            }
        }
        return Result<ReceivedEvent?>.Success(null);
    }
    public static async ValueTask<Result<ReadBatch>> Collect(LocalState storage, MessagingClient messaging, ClientSettings settings, string file, int limit, int maximum, ReadBatch initial, WakeCycle cycle, IReadOnlySet<string> allowed, MessageArtifacts artifacts, CancellationToken cancellation)
    {
        var batch = initial; var rooms = cycle.Ends.Keys.Where(allowed.Contains).Order(StringComparer.Ordinal).ToArray();
        for (var position = 0; position < rooms.Length; position++)
        {
            var room = rooms[position]; var remaining = ReceivePages.RoomQuota(limit, rooms.Length, position) - batch.Events.Count(value => value.RoomId == room); if (remaining <= 0 || batch.Cursors.GetValueOrDefault(room) == cycle.Ends[room].Cursor) continue;
            var next = await UnreadMessages.Read(storage, messaging, settings, file, remaining, maximum, room, null, new HashSet<string>([room], StringComparer.Ordinal), new(batch.Cursors, cycle.Ends), artifacts.Stage, cancellation); if (!next.IsSuccess) return next;
            IReadOnlyList<ReceivedEvent> events = [.. batch.Events, .. next.Value.Events]; if (events.Any(value => value.ContentFile is not null) || UnreadMessages.AcquisitionBytes(events, settings) > maximum) events = artifacts.Stage(events);
            batch = new(events, Merge(batch.Cursors, ReceiveState.Filter(next.Value.Cursors, new HashSet<string>([room], StringComparer.Ordinal))), [], Merge(batch.Latest, next.Value.Latest));
        }
        return Result<ReadBatch>.Success(batch with { Events = batch.Events.OrderBy(value => value.Timestamp ?? "", StringComparer.Ordinal).ToArray(), MoreRooms = rooms.Where(room => batch.Cursors.GetValueOrDefault(room) != cycle.Ends[room].Cursor).ToArray() });
    }
}
