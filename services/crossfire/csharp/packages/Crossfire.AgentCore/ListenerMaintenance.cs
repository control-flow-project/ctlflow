using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed class ListenerMaintenance(LocalState storage, string file, string agent, Coordination coordination, TimeProvider clock, int interval,
    Func<CancellationToken, ValueTask<Result<IReadOnlyList<string>>>> invitations)
{
    private readonly object gate = new();
    private readonly Dictionary<string, long> pending = new(StringComparer.Ordinal);
    private readonly Dictionary<(string Room, string Event), ReceivedEvent?> notices = Load(storage, file);
    private long requested, checkedRevision = -1, lastCheck = long.MinValue;
    private long Now => clock.GetUtcNow().ToUnixTimeMilliseconds();
    private static Dictionary<(string, string), ReceivedEvent?> Load(LocalState storage, string file)
    {
        var result = new Dictionary<(string, string), ReceivedEvent?>(); if (!storage.Exists(file)) return result; var value = AgentIO.Read(storage, file, 25165824); if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > 10000) throw new InvalidDataException("Invalid listener maintenance journal");
        foreach (var notice in value.EnumerateArray()) { if (!Validation.Fields(notice, ["room", "event"]).IsSuccess || WireJson.Text(notice, "room") is not { } room || !Validation.RoomId(room) || WireJson.Text(notice, "event") is not { } id || !Validation.EventId(id) || !result.TryAdd((room, id), null)) throw new InvalidDataException("Invalid or duplicate listener maintenance notice"); } return result;
    }
    private void Save() { if (notices.Count == 0) AgentIO.Remove(storage, file); else AgentIO.Write(storage, file, WireJson.Array(writer => { foreach (var key in notices.Keys) { writer.WriteStartObject(); writer.WriteString("room", key.Room); writer.WriteString("event", key.Event); writer.WriteEndObject(); } }), 25165824); }
    public void Observe(JsonElement sync) { if (SyncEvents.Section(sync, "invite")?.EnumerateObject().Any() == true || SyncEvents.Section(sync, "leave")?.EnumerateObject().Any() == true) Interlocked.Increment(ref requested); }
    public void Notice(ReceivedEvent value) { lock (gate) { if (notices.ContainsKey((value.RoomId, value.EventId))) return; if (notices.Count >= 10000) throw new InvalidDataException("Pending blocked-mention notices exceed the bounded ordinary queue"); notices.Add((value.RoomId, value.EventId), value); Save(); } }
    public bool Pending { get { lock (gate) return notices.Count != 0 || requested != checkedRevision || lastCheck == long.MinValue || Now - lastCheck >= interval || pending.Values.Any(at => at == long.MinValue || Now - at >= interval); } }
    public ValueTask<Result<bool>> Publish(CancellationToken cancellation) => AgentIO.Boundary(async () =>
    {
        var joined = false; var revision = Interlocked.Read(ref requested);
        if (revision != checkedRevision || lastCheck == long.MinValue || Now - lastCheck >= interval)
        {
            var response = await invitations(cancellation); if (!response.IsSuccess) return Result<bool>.Fail(response.Error); var native = response.Value.ToHashSet(StringComparer.Ordinal); if (native.Any(room => !Validation.RoomId(room)) || native.Count > 1000) return Results.Fail<bool>("invalid", "Invalid native invitation inventory");
            lock (gate) { foreach (var room in pending.Keys.Where(room => !native.Contains(room)).ToArray()) pending.Remove(room); foreach (var room in native) pending.TryAdd(room, long.MinValue); checkedRevision = revision; lastCheck = Now; }
        }
        KeyValuePair<string, long>[] due; lock (gate) due = pending.Where(value => value.Value == long.MinValue || Now - value.Value >= interval).Take(10).ToArray();
        foreach (var entry in due)
        {
            var accepted = await coordination.Agent("acceptRoomInvitation", agent, WireJson.Object(writer => writer.WriteString("roomId", entry.Key)), cancellation); cancellation.ThrowIfCancellationRequested();
            if (!accepted.IsSuccess && accepted.Error.Code is not ("forbidden" or "missing" or "conflict" or "limit")) return Result<bool>.Fail(accepted.Error);
            lock (gate) { pending[entry.Key] = Now; if (accepted.IsSuccess && accepted.Value.TryGetProperty("accepted", out var value) && value.ValueKind == JsonValueKind.True) { pending.Remove(entry.Key); joined = true; } }
        }
        (string Room, string Event)[] selected; lock (gate) selected = notices.Keys.ToArray();
        foreach (var key in selected) { var result = await coordination.Agent("wakeNotice", agent, WireJson.Object(writer => writer.WriteString("roomId", key.Room)), cancellation, new Dictionary<string, string> { ["eventId"] = key.Event }); if (!result.IsSuccess) return Result<bool>.Fail(result.Error); lock (gate) { notices.Remove(key); Save(); } }
        return Result<bool>.Success(joined);
    });
}
