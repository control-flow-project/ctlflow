using System.Text;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed record PublicationOutcome(ReadBatch Batch, IReadOnlyList<string> MessageIds);
public sealed class ChatPublication
{
    private sealed record Step(IReadOnlyList<int> Indices, string Text, string Id, string? Room, string? Session, string Status);
    private sealed record Plan(ReadBatch Batch, IReadOnlyList<PrincipalIdentity> Identities, List<Step> Steps);
    private const int MaximumJournal = 134217728;
    private readonly LocalState storage;
    private readonly string file;
    private readonly ClientSettings settings;
    private readonly RuntimeConnection runtime;
    private readonly NativeHistoryMode mode;
    private readonly Func<int> maximum;
    private readonly InputPriority? priority;
    private readonly MessageArtifacts artifacts;
    private readonly Func<ReceivedEvent, bool> admit;
    private readonly Func<string, string, ValueTask<Result<Unit>>> delivered;
    private readonly Action<int> count;
    private readonly Action<IReadOnlyList<ReceivedEvent>> traffic;
    private Plan? plan;
    private int operating;
    public ChatPublication(LocalState storage, string file, ClientSettings settings, RuntimeConnection runtime, NativeHistoryMode mode, Func<int> maximum, MessageArtifacts artifacts,
        Func<ReceivedEvent, bool> admit, Func<string, string, ValueTask<Result<Unit>>> delivered, Action<int> count, Action<IReadOnlyList<ReceivedEvent>> traffic, InputPriority? priority = null)
    {
        this.storage = storage; this.file = file; this.settings = settings; this.runtime = runtime; this.mode = mode; this.maximum = maximum; this.artifacts = artifacts; this.admit = admit; this.delivered = delivered; this.count = count; this.traffic = traffic; this.priority = priority;
        if (maximum() is < 1024 or > AgentIO.MaximumInputBytes) throw new InvalidDataException("Invalid chat input limit"); if (storage.Exists(file)) plan = Decode(AgentIO.Read(storage, file, MaximumJournal));
    }
    private string Mode => mode == NativeHistoryMode.Shared ? "shared" : "per-room";
    private Plan Decode(JsonElement value)
    {
        if (!Validation.Fields(value, ["mode", "batch", "identities", "steps"]).IsSuccess || WireJson.Text(value, "mode") != Mode) throw new InvalidDataException("Invalid pending publication or changed native history configuration");
        var batch = ReceiveState.Decode(value.GetProperty("batch")); var identities = Validation.List(value.GetProperty("identities"), CoordinationValues.Identity, int.MaxValue);
        if (!batch.IsSuccess || !identities.IsSuccess || value.GetProperty("steps").ValueKind != JsonValueKind.Array) throw new InvalidDataException("Invalid retained publication identities or events");
        var steps = new List<Step>();
        foreach (var source in value.GetProperty("steps").EnumerateArray())
        {
            if (!Validation.Fields(source, ["indices", "text", "id", "room", "session", "status"]).IsSuccess) throw new InvalidDataException("Invalid retained publication step");
            var indices = Validation.List(source.GetProperty("indices"), number => Validation.Integer(number, 0, Math.Max(0, batch.Value.Events.Count - 1)).Map(value => (int)value), batch.Value.Events.Count, 1);
            var text = WireJson.Text(source, "text"); var id = Validation.Text(source.GetProperty("id"), 200); var room = Validation.NullableText(source.GetProperty("room")); var session = Validation.NullableText(source.GetProperty("session")); var status = Validation.Choice(source.GetProperty("status"), "prepared", "publishing", "delivered");
            if (!indices.IsSuccess || indices.Value.Distinct().Count() != indices.Value.Count || text is null || Encoding.UTF8.GetByteCount(text) > AgentIO.MaximumInputBytes || !id.IsSuccess || !room.IsSuccess || room.Value is not null && !Validation.RoomId(room.Value)
                || !session.IsSuccess || !status.IsSuccess || status.Value != "prepared" && session.Value is null) throw new InvalidDataException("Invalid retained native publication evidence");
            steps.Add(new(indices.Value, text, id.Value, room.Value, session.Value, status.Value));
        }
        return new(batch.Value, identities.Value, steps);
    }
    private void Save()
    {
        var current = plan ?? throw new InvalidOperationException("No native publication plan");
        AgentIO.Write(storage, file, WireJson.Object(writer =>
        {
            writer.WriteString("mode", Mode); writer.WritePropertyName("batch"); ReceiveState.Encode(current.Batch).WriteTo(writer); writer.WriteStartArray("identities"); foreach (var identity in current.Identities) CoordinationValues.Encode(identity).WriteTo(writer); writer.WriteEndArray(); writer.WriteStartArray("steps");
            foreach (var step in current.Steps) { writer.WriteStartObject(); writer.WriteStartArray("indices"); foreach (var index in step.Indices) writer.WriteNumberValue(index); writer.WriteEndArray(); writer.WriteString("text", step.Text); writer.WriteString("id", step.Id); writer.WriteString("room", step.Room); writer.WriteString("session", step.Session); writer.WriteString("status", step.Status); writer.WriteEndObject(); } writer.WriteEndArray();
        }), MaximumJournal);
    }
    public bool Pending => plan is not null;
    public bool Unpublished => plan is { } value && value.Steps.All(step => step.Status == "prepared");
    public bool Recovering => plan?.Steps.Any(step => step.Status == "publishing") == true;
    public IReadOnlyList<ReceivedEvent> Events => plan?.Batch.Events ?? [];
    public IReadOnlyList<string> ContentFiles => Events.Where(value => value.ContentFile is not null).Select(value => value.ContentFile!.File).ToArray();
    private List<Step> Steps(IReadOnlyList<ReceivedEvent> events, IReadOnlyList<PrincipalIdentity> identities, IReadOnlyList<ReceivedEvent> records)
    {
        var positions = records.Select((value, index) => (value.RoomId, value.EventId, Index: index)).ToDictionary(value => (value.RoomId, value.EventId), value => value.Index);
        return ChatBatches.Prepare(events, settings, identities.ToDictionary(value => value.BackendUserId, StringComparer.Ordinal), maximum(), mode, artifacts)
            .Select(batch => new Step(batch.Events.Select(value => positions[(value.RoomId, value.EventId)]).ToArray(), batch.Text, batch.MessageId, batch.Room, null, "prepared")).ToList();
    }
    public Result<Unit> Prepare(ReadBatch batch, IReadOnlyList<ReceivedEvent> events, IReadOnlyDictionary<string, PrincipalIdentity> identities)
    {
        if (plan is not null || Volatile.Read(ref operating) != 0) return Results.Fail<Unit>("conflict", "Settle the original publication before preparing another");
        var enriched = events.ToDictionary(value => (value.RoomId, value.EventId)); var records = batch.Events.Select(value => enriched.GetValueOrDefault((value.RoomId, value.EventId)) ?? value).ToArray();
        plan = new(batch with { Events = records }, identities.Values.ToArray(), Steps(events, identities.Values.ToArray(), records)); Save(); return Results.Done();
    }
    private IReadOnlyList<ReceivedEvent> StepEvents(Step step) => step.Indices.Select(index => plan!.Batch.Events[index]).ToArray();
    private void Replace(int index, Step previous, IReadOnlyList<ReceivedEvent> events)
    {
        var replacement = Steps(events, plan!.Identities, plan.Batch.Events); plan.Steps.RemoveAt(index); plan.Steps.InsertRange(index, replacement); Save();
        if (replacement.All(step => step.Id != previous.Id)) artifacts.Release([previous.Id]);
    }
    private PublicationOutcome? Outcome(IReadOnlySet<string> allowed)
    {
        if (plan is null || plan.Steps.Any(step => step.Status != "delivered")) return null;
        return new(plan.Batch with { Cursors = ReceiveState.Filter(plan.Batch.Cursors, allowed), Latest = ReceiveState.Filter(plan.Batch.Latest, allowed), MoreRooms = plan.Batch.MoreRooms.Where(allowed.Contains).ToArray() }, plan.Steps.Select(step => step.Id).ToArray());
    }
    private async ValueTask<Result<RuntimeConnection>> Target(Step step, CancellationToken cancellation)
        => step.Room is null ? Result<RuntimeConnection>.Success(runtime) : await runtime.Conversation(step.Room, priority is null ? null : new(priority.Value, cancellation));
    public ValueTask<Result<PublicationOutcome?>> Recover(IReadOnlySet<string> allowed, CancellationToken cancellation) => Operate(async () =>
    {
        if (plan is null) return Result<PublicationOutcome?>.Success(null);
        for (var index = 0; index < plan.Steps.Count; index++)
        {
            var step = plan.Steps[index]; if (step.Status != "publishing") continue; var selected = await Target(step, cancellation); if (!selected.IsSuccess) return Result<PublicationOutcome?>.Fail(selected.Error);
            if (selected.Value.SessionId != step.Session) return Results.Fail<PublicationOutcome?>("conflict", "Original pending history is unavailable; input was not retargeted");
            var received = await selected.Value.Recover(step.Text, step.Id, cancellation); if (!received.IsSuccess) return Result<PublicationOutcome?>.Fail(received.Error);
            plan.Steps[index] = step with { Status = received.Value ? "delivered" : "prepared" }; Save(); if (received.Value) { var events = StepEvents(step); count(events.Count(value => value.Type == "message")); traffic(events); }
        }
        return Result<PublicationOutcome?>.Success(Outcome(allowed));
    });
    public ValueTask<Result<PublicationOutcome?>> Publish(IReadOnlySet<string> allowed, CancellationToken cancellation) => Operate(async () =>
    {
        if (plan is null) return Result<PublicationOutcome?>.Success(null);
        for (var index = 0; index < plan.Steps.Count; index++)
        {
            var step = plan.Steps[index]; if (step.Status == "delivered") continue; cancellation.ThrowIfCancellationRequested(); var events = StepEvents(step);
            var remaining = events.Where(value => allowed.Contains(value.RoomId) && admit(value)).ToArray();
            if (step.Status == "prepared" && (remaining.Length != events.Count || Encoding.UTF8.GetByteCount(step.Text) > maximum())) { Replace(index, step, remaining); index--; continue; }
            var selected = await Target(step, cancellation); if (!selected.IsSuccess) return Result<PublicationOutcome?>.Fail(selected.Error); var target = selected.Value;
            if (step.Session is not null && step.Session != target.SessionId) return Results.Fail<PublicationOutcome?>("conflict", "Pending input belongs to another native history");
            if (step.Status == "publishing")
            {
                var received = await target.Recover(step.Text, step.Id, cancellation); if (!received.IsSuccess) return Result<PublicationOutcome?>.Fail(received.Error);
                if (received.Value) { plan.Steps[index] = step with { Status = "delivered" }; Save(); count(events.Count(value => value.Type == "message")); traffic(events); continue; }
            }
            remaining = events.Where(value => allowed.Contains(value.RoomId) && admit(value)).ToArray(); if (remaining.Length != events.Count) { Replace(index, step, remaining); index--; continue; }
            if (priority is not null) { var settled = await target.Settle(cancellation); if (!settled.IsSuccess) return Result<PublicationOutcome?>.Fail(settled.Error); }
            step = step with { Session = target.SessionId, Status = "publishing" }; plan.Steps[index] = step; Save();
            var published = await target.Deliver(step.Text, step.Id, cancellation, priority); if (!published.IsSuccess) return Result<PublicationOutcome?>.Fail(published.Error);
            plan.Steps[index] = step with { Status = "delivered" }; Save(); count(events.Count(value => value.Type == "message")); traffic(events);
            var room = events.LastOrDefault(value => value.Type == "message")?.RoomId; if (room is not null) { var noted = await delivered(room, target.SessionId); if (!noted.IsSuccess) return Result<PublicationOutcome?>.Fail(noted.Error); }
        }
        return Result<PublicationOutcome?>.Success(Outcome(allowed));
    });
    private async ValueTask<Result<PublicationOutcome?>> Operate(Func<ValueTask<Result<PublicationOutcome?>>> action)
    {
        if (Interlocked.CompareExchange(ref operating, 1, 0) != 0) return Results.Fail<PublicationOutcome?>("conflict", "Another native publication operation is in progress");
        try { return await AgentIO.Boundary(action); } finally { Interlocked.Exchange(ref operating, 0); }
    }
    public Result<Unit> DiscardUnpublished()
    { if (plan?.Steps.Any(step => step.Status != "prepared") == true || Volatile.Read(ref operating) != 0) return Results.Fail<Unit>("conflict", "Resolve original native evidence before discarding input"); return Clear(); }
    public Result<Unit> Acknowledge()
    { if (plan?.Steps.Any(step => step.Status != "delivered") == true || Volatile.Read(ref operating) != 0) return Results.Fail<Unit>("conflict", "Cannot discard unconfirmed native input"); return Clear(); }
    private Result<Unit> Clear() { if (plan is not null) artifacts.Release(plan.Steps.Select(step => step.Id).ToArray()); AgentIO.Remove(storage, file); plan = null; return Results.Done(); }
}
