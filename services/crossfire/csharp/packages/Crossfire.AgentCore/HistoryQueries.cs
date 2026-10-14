using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed record HistoryRequest(string Kind, string? Room, int Limit, int OutputBytes, string Direction, IReadOnlyDictionary<string, string> Cursors);
public sealed class HistoryQueries
{
    private sealed record PendingQuery(string Id, IReadOnlyDictionary<string, string> Base, ReadBatch Batch, string MessageId, long ExpiresAt, string Stage);
    private readonly LocalState storage;
    private readonly string file, pendingFile;
    private readonly AgentMatrix matrix;
    private readonly AgentProfile profile;
    private readonly Coordination coordination;
    private readonly TimeProvider clock;
    private readonly MessageArtifacts artifacts;
    private readonly Func<bool> publishing;
    private readonly Action<IReadOnlyList<ReceivedEvent>> observed, delivered;
    private readonly Action acknowledged;
    private readonly CancellationToken stop;
    private readonly object gate;
    private CancellationTokenSource? current;
    private TaskCompletionSource? finished;
    private int reading;
    public HistoryQueries(LocalState storage, string file, AgentMatrix matrix, AgentProfile profile, Coordination coordination, TimeProvider clock, MessageArtifacts artifacts, Func<bool> publishing,
        Action<IReadOnlyList<ReceivedEvent>> observed, Action<IReadOnlyList<ReceivedEvent>> delivered, Action acknowledged, CancellationToken stop, object gate)
    { this.storage = storage; this.file = file; pendingFile = file + ".query"; this.matrix = matrix; this.profile = profile; this.coordination = coordination; this.clock = clock; this.artifacts = artifacts; this.publishing = publishing; this.observed = observed; this.delivered = delivered; this.acknowledged = acknowledged; this.stop = stop; this.gate = gate; }
    private CancellationTokenSource? Begin(bool exclusive)
    { lock (gate) { if (reading != 0 || exclusive && publishing()) return null; reading = 1; current = new(); finished = new(TaskCreationOptions.RunContinuationsAsynchronously); return current; } }
    private void End(CancellationTokenSource selected)
    { TaskCompletionSource? complete; lock (gate) { reading = 0; current = null; complete = finished; finished = null; } selected.Dispose(); complete?.TrySetResult(); }
    public async ValueTask Invalidate()
    { CancellationTokenSource? cancellation; Task? done; lock (gate) { cancellation = current; done = finished?.Task; } if (cancellation is not null) { try { await cancellation.CancelAsync(); } catch (ObjectDisposedException) { } } if (done is not null) await done; }
    public static Result<HistoryRequest> Parse(JsonElement value)
    {
        if (!Validation.Fields(value, ["kind", "limit", "outputBytes", "direction", "cursors"], ["room"]).IsSuccess) return Results.Fail<HistoryRequest>("invalid", "Invalid receiver history request");
        var kind = Validation.Choice(value.GetProperty("kind"), "unread", "history"); var limit = Validation.Integer(value.GetProperty("limit"), 1, 100); var bytes = Validation.Integer(value.GetProperty("outputBytes"), 1024, 98304); var direction = Validation.Choice(value.GetProperty("direction"), "b", "f"); var room = WireJson.Text(value, "room");
        if (!kind.IsSuccess || !limit.IsSuccess || !bytes.IsSuccess || !direction.IsSuccess || value.TryGetProperty("room", out _) && (room is null || !Validation.RoomId(room)) || !Validation.Fields(value.GetProperty("cursors"), ["entries"]).IsSuccess) return Results.Fail<HistoryRequest>("invalid", "Invalid history limits, direction or room");
        var entries = value.GetProperty("cursors").GetProperty("entries"); if (entries.ValueKind != JsonValueKind.Array || entries.GetArrayLength() > 1000) return Results.Fail<HistoryRequest>("invalid", "Invalid history continuations"); var cursors = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var entry in entries.EnumerateArray())
        {
            if (!Validation.Fields(entry, ["room", "cursor"]).IsSuccess) return Results.Fail<HistoryRequest>("invalid", "Invalid history continuation"); var identity = WireJson.Text(entry, "room"); var cursor = Validation.Text(entry.GetProperty("cursor"), 4096);
            if (identity is null || !Validation.RoomId(identity) || !cursor.IsSuccess || !cursors.TryAdd(identity, cursor.Value)) return Results.Fail<HistoryRequest>("invalid", "Invalid or duplicated history room");
        }
        return Result<HistoryRequest>.Success(new(kind.Value, room, (int)limit.Value, (int)bytes.Value, direction.Value, cursors));
    }
    private PendingQuery Load()
    {
        var value = AgentIO.Read(storage, pendingFile, AgentIO.HistoryBytes); if (!Validation.Fields(value, ["id", "base", "batch", "messageId", "expiresAt", "stage"]).IsSuccess) throw new InvalidDataException("Invalid pending unread query");
        var id = WireJson.Text(value, "id"); var original = ReceiveState.Cursors(value.GetProperty("base")); var batch = ReceiveState.Decode(value.GetProperty("batch")); var message = WireJson.Text(value, "messageId"); var expires = Validation.Integer(value.GetProperty("expiresAt")); var stage = Validation.Choice(value.GetProperty("stage"), "prepared", "acknowledging");
        if (id is null || !Validation.Identifier(id) || !original.IsSuccess || !batch.IsSuccess || message != "query-" + id || !expires.IsSuccess || !stage.IsSuccess) throw new InvalidDataException("Invalid pending unread query evidence"); return new(id, original.Value, batch.Value, message, expires.Value, stage.Value);
    }
    private void Save(PendingQuery value) => AgentIO.Write(storage, pendingFile, WireJson.Object(writer => { writer.WriteString("id", value.Id); writer.WritePropertyName("base"); ReceiveState.Encode(value.Base).WriteTo(writer); writer.WritePropertyName("batch"); ReceiveState.Encode(value.Batch).WriteTo(writer); writer.WriteString("messageId", value.MessageId); writer.WriteNumber("expiresAt", value.ExpiresAt); writer.WriteString("stage", value.Stage); }), AgentIO.HistoryBytes);
    private void Expire()
    { lock (gate) { if (!storage.Exists(pendingFile) || reading != 0) return; var value = Load(); if (value.Stage == "prepared" && value.ExpiresAt <= clock.GetUtcNow().ToUnixTimeMilliseconds()) { storage.Remove(pendingFile); artifacts.Release([value.MessageId]); } } }
    public IReadOnlyList<string> ContentFiles => storage.Exists(pendingFile) ? Load().Batch.Events.Where(value => value.ContentFile is not null).Select(value => value.ContentFile!.File).ToArray() : [];
    public bool Pending { get { Expire(); return Volatile.Read(ref reading) != 0 || storage.Exists(pendingFile); } }
    public bool Recovering => Volatile.Read(ref reading) == 0 && storage.Exists(pendingFile) && Load().Stage == "acknowledging";
    private async ValueTask<Result<(ListenerPolicy Policy, IReadOnlySet<string> Rooms)>> Allowed(CancellationToken cancellation)
    {
        var policy = await OwnerAuthority.Policy(coordination, profile, cancellation); if (!policy.IsSuccess) return Result<(ListenerPolicy, IReadOnlySet<string>)>.Fail(policy.Error); var joined = await ReceivePages.Joined(matrix, cancellation); if (!joined.IsSuccess) return Result<(ListenerPolicy, IReadOnlySet<string>)>.Fail(joined.Error);
        return Result<(ListenerPolicy, IReadOnlySet<string>)>.Success((policy.Value, policy.Value.Rooms.Where(grant => joined.Value.Contains(grant.RoomId)).Select(grant => grant.RoomId).ToHashSet(StringComparer.Ordinal)));
    }
    public async ValueTask<Result<JsonElement>> Read(HistoryRequest input, CancellationToken cancellation)
    {
        Expire(); var selected = Begin(input.Kind == "unread"); if (selected is null) return Results.Fail<JsonElement>("conflict", "The receiver is settling another publication or query; use history browsing or retry catch-up after settlement");
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30), clock); using var scope = CancellationTokenSource.CreateLinkedTokenSource(stop, cancellation, deadline.Token, selected.Token);
        try { return await AgentIO.Boundary(async () =>
        {
            if (input.Kind == "unread" && publishing()) return Results.Fail<JsonElement>("conflict", "The receiver is settling another publication; use history browsing or retry catch-up after settlement");
            var original = ReceiveState.Load(storage, file); var authority = await Allowed(scope.Token); if (!authority.IsSuccess) return Result<JsonElement>.Fail(authority.Error); var (policy, allowed) = authority.Value;
            if (input.Room is not null && !allowed.Contains(input.Room) || input.Cursors.Keys.Any(room => !allowed.Contains(room))) return Results.Fail<JsonElement>("forbidden", "Requested room is outside current agent access");
            ReadBatch batch;
            if (input.Kind == "unread")
            {
                if (storage.Exists(pendingFile)) return Results.Fail<JsonElement>("conflict", "A previous unread query needs its acknowledgment before another catch-up"); if (input.Cursors.Count != 0) return Results.Fail<JsonElement>("invalid", "Unread queries use saved delivery checkpoints, not supplied history cursors");
                var unread = await UnreadMessages.Read(storage, matrix, profile.Settings, file, input.Limit, policy.MaxMessageBytes, input.Room, null, allowed, null, artifacts.Stage, scope.Token); if (!unread.IsSuccess) return Result<JsonElement>.Fail(unread.Error); batch = unread.Value;
            }
            else
            {
                var rooms = input.Room is not null ? [input.Room] : allowed.Order(StringComparer.Ordinal).ToArray(); var events = new List<ReceivedEvent>(); var more = new List<string>(); var next = new Dictionary<string, string>(StringComparer.Ordinal); var fileMode = false;
                for (var index = 0; index < rooms.Length; index++)
                {
                    var room = rooms[index]; var query = new Dictionary<string, string>(StringComparer.Ordinal) { ["dir"] = input.Direction }; if (input.Cursors.TryGetValue(room, out var from)) query["from"] = from;
                    var page = await ReceivePages.History(matrix, room, query, ReceivePages.RoomQuota(input.Limit, rooms.Length, index), scope.Token); if (!page.IsSuccess) return Result<JsonElement>.Fail(page.Error); var messages = new List<ReceivedEvent>();
                    foreach (var value in page.Value.Chunk) { var parsed = ReceivedEvents.View(value, room); if (!parsed.IsSuccess) return Result<JsonElement>.Fail(parsed.Error); messages.Add(parsed.Value); }
                    if (fileMode || UnreadMessages.AcquisitionBytes([..events, ..messages], profile.Settings) > policy.MaxMessageBytes) { fileMode = true; events = artifacts.Stage(events).ToList(); messages = artifacts.Stage(messages).ToList(); }
                    events.AddRange(messages); if (page.Value.End is { } end) next[room] = end; if (page.Value.Chunk.Count >= page.Value.RequestedLimit) more.Add(room);
                }
                batch = new(events, next, more, new Dictionary<string, string>(StringComparer.Ordinal));
            }
            var enriched = await ReceivePages.Origins(matrix, profile.Account.UserId, batch.Events, scope.Token); if (!enriched.IsSuccess) return Result<JsonElement>.Fail(enriched.Error); if (input.Kind == "unread") observed(enriched.Value);
            var identities = await CoordinationValues.Senders(coordination, enriched.Value, scope.Token); if (!identities.IsSuccess) return Result<JsonElement>.Fail(identities.Error); scope.Token.ThrowIfCancellationRequested();
            var envelope = ChatBatches.Envelope(enriched.Value, profile.Settings, identities.Value); var result = WireJson.Object(writer =>
            {
                foreach (var field in envelope.EnumerateObject()) field.WriteTo(writer); writer.WriteStartArray("more_rooms"); foreach (var room in batch.MoreRooms) writer.WriteStringValue(room); writer.WriteEndArray(); writer.WriteStartObject("continuation"); writer.WriteStartArray("entries"); foreach (var cursor in batch.Cursors.Where(value => allowed.Contains(value.Key))) { writer.WriteStartObject(); writer.WriteString("room", cursor.Key); writer.WriteString("cursor", cursor.Value); writer.WriteEndObject(); } writer.WriteEndArray(); writer.WriteEndObject();
            });
            var metadata = WireJson.Object(writer => { foreach (var field in result.EnumerateObject()) if (field.Name != "events") field.WriteTo(writer); }); var id = Identity.Identifier(); var message = "query-" + id; var text = artifacts.Prepare(enriched.Value, WireJson.Pretty(result).TrimEnd('\n'), message, Math.Min(input.OutputBytes - 1, policy.MaxMessageBytes), metadata);
            if (input.Kind == "unread") { if (publishing() || !ReceiveState.Same(original, ReceiveState.Load(storage, file))) { artifacts.Release([message]); return Results.Fail<JsonElement>("conflict", "Delivery checkpoints changed during the query; no unread state was advanced"); } Save(new(id, original, batch, message, clock.GetUtcNow().ToUnixTimeMilliseconds() + 300000, "prepared")); } else artifacts.Release([message]);
            return Result<JsonElement>.Success(WireJson.Object(writer => { writer.WriteString("queryId", input.Kind == "unread" ? id : null); writer.WriteString("text", text); }));
        }); } finally { End(selected); }
    }
    public async ValueTask<Result<JsonElement>> Acknowledge(string id, CancellationToken cancellation)
    {
        Expire(); var selected = Begin(true); if (selected is null) return Results.Fail<JsonElement>("conflict", "The receiver is settling another publication or query");
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30), clock); using var scope = CancellationTokenSource.CreateLinkedTokenSource(stop, cancellation, deadline.Token, selected.Token);
        try { return await AgentIO.Boundary(async () =>
        {
            if (!storage.Exists(pendingFile)) return Results.Fail<JsonElement>("missing", "Unread query not found"); var pending = Load(); if (pending.Id != id) return Results.Fail<JsonElement>("conflict", "Unread query identity changed"); var authority = await Allowed(scope.Token); if (!authority.IsSuccess) return Result<JsonElement>.Fail(authority.Error);
            if (pending.Batch.Events.Any(value => !authority.Value.Rooms.Contains(value.RoomId))) { storage.Remove(pendingFile); artifacts.Release([pending.MessageId]); return Results.Fail<JsonElement>("forbidden", "Room access changed before query acknowledgment"); }
            var current = ReceiveState.Load(storage, file); if (publishing() || !ReceiveState.Same(current, pending.Base) && (pending.Stage != "acknowledging" || !ReceiveState.Same(current, pending.Batch.Cursors))) return Results.Fail<JsonElement>("conflict", "Delivery checkpoints changed; the unread query was not acknowledged");
            Save(pending with { Stage = "acknowledging" }); var accepted = await ReceiveState.Acknowledge(storage, matrix, file, pending.Batch, scope.Token); if (!accepted.IsSuccess) return Result<JsonElement>.Fail(accepted.Error); delivered(pending.Batch.Events); storage.Remove(pendingFile); artifacts.Release([pending.MessageId]); acknowledged(); return Result<JsonElement>.Success(WireJson.Object(writer => writer.WriteBoolean("accepted", true)));
        }); } finally { End(selected); }
    }
    public async ValueTask<Result<Unit>> Recover(CancellationToken cancellation)
    { if (!Recovering) return Results.Done(); return (await Acknowledge(Load().Id, cancellation)).Map(_ => default(Unit)); }
}
