using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed class OwnerObservation : IAsyncDisposable
{
    private sealed record Output(string Id, string Text, IReadOnlyList<string> Sources, string? StreamId, bool Sealed);
    private const int MaximumJournal = 67108864;
    private readonly object gate = new();
    private readonly LocalState storage;
    private readonly string file;
    private readonly AgentProfile profile;
    private readonly MessagingClient messaging;
    private readonly Coordination coordination;
    private readonly TimeProvider clock;
    private readonly NativeHistoryMode mode;
    private readonly Func<int> maximum;
    private readonly Func<NativeSessionState?> native;
    private readonly Action<Failure> failed;
    private readonly List<Output> output = [];
    private readonly List<RuntimeObservation> observations = [];
    private readonly Dictionary<string, RuntimeObservation> latest = new(StringComparer.Ordinal);
    private readonly Dictionary<string, bool> active = new(StringComparer.Ordinal);
    private readonly HashSet<string> sources = new(StringComparer.Ordinal);
    private readonly ListenerSignal signal = new();
    private readonly CancellationTokenSource lifetime;
    private readonly SemaphoreSlim typing = new(1, 1);
    private string? run, deliveredSession, typingRoom;
    private long? lastActivity;
    private RuntimeObservation? publishing;
    private ITimer? typingTimer;
    private long typingGeneration;
    private Task? running, closing;
    private bool clearTyping;
    public OwnerObservation(LocalState storage, string file, AgentProfile profile, MessagingClient messaging, Coordination coordination, TimeProvider clock, NativeHistoryMode mode, Func<int> maximum, Func<NativeSessionState?> native, Action<Failure> failed, CancellationToken stop)
    {
        this.storage = storage; this.file = file; this.profile = profile; this.messaging = messaging; this.coordination = coordination; this.clock = clock; this.mode = mode; this.maximum = maximum; this.native = native; this.failed = failed;
        if (storage.Exists(file))
        {
            var journal = AgentIO.Read(storage, file, MaximumJournal); if (!Validation.Fields(journal, ["output", "observations"]).IsSuccess || journal.GetProperty("output").ValueKind != JsonValueKind.Array || journal.GetProperty("observations").ValueKind != JsonValueKind.Array) throw new InvalidDataException("Invalid owner observation journal; retained state requires owner inspection");
            foreach (var value in journal.GetProperty("output").EnumerateArray())
            {
                if (!Validation.Fields(value, ["id", "text", "sources", "streamId", "sealed"]).IsSuccess) throw new InvalidDataException("Invalid owner observation journal");
                var id = WireJson.Text(value, "id"); var text = WireJson.Text(value, "text"); var stream = Validation.NullableText(value.GetProperty("streamId")); var chunks = Validation.List(value.GetProperty("sources"), source => Validation.Text(source), int.MaxValue, 1); var sealedValue = Validation.Boolean(value.GetProperty("sealed"));
                if (id is null || text is null || !messaging.NoticeFits(text) || !stream.IsSuccess || !chunks.IsSuccess || !sealedValue.IsSuccess) throw new InvalidDataException("Invalid owner observation journal");
                output.Add(new(id, text, chunks.Value, stream.Value, sealedValue.Value)); foreach (var source in chunks.Value) sources.Add(source);
            }
            foreach (var value in journal.GetProperty("observations").EnumerateArray()) { var parsed = AgentWire.Observation(value); if (!parsed.IsSuccess) throw new InvalidDataException(parsed.Error.Message); observations.Add(parsed.Value); latest[parsed.Value.SessionId] = parsed.Value; if (parsed.Value.LastActivityAt is { } time) lastActivity = Math.Max(lastActivity ?? 0, time); }
        }
        lifetime = CancellationTokenSource.CreateLinkedTokenSource(stop);
    }
    private long Now => clock.GetUtcNow().ToUnixTimeMilliseconds();
    private void Save() => AgentIO.Write(storage, file, WireJson.Object(writer =>
    {
        writer.WriteStartArray("output"); foreach (var item in output) { writer.WriteStartObject(); writer.WriteString("id", item.Id); writer.WriteString("text", item.Text); writer.WriteStartArray("sources"); foreach (var source in item.Sources) writer.WriteStringValue(source); writer.WriteEndArray(); writer.WriteString("streamId", item.StreamId); writer.WriteBoolean("sealed", item.Sealed); writer.WriteEndObject(); } writer.WriteEndArray();
        writer.WriteStartArray("observations"); foreach (var value in observations) AgentWire.Observation(value).WriteTo(writer); writer.WriteEndArray();
    }), MaximumJournal);
    public bool Busy { get { lock (gate) return active.Values.Any(value => value); } }
    public void Notice(string identity, string text)
    {
        lock (gate)
        {
            var position = 0; foreach (var part in messaging.NoticeChunks(text)) { var id = Identity.Hash(WireJson.Compact(WireJson.Array(writer => { writer.WriteStringValue("listener-notice"); writer.WriteStringValue(identity); writer.WriteNumberValue(position++); }))); if (sources.Add(id)) output.Add(new(id, part, [id], null, true)); } Save();
        }
        signal.Wake();
    }
    public void Observe(RuntimeObservationEvent value)
    {
        if (lifetime.IsCancellationRequested) return;
        var current = value is NativeState ? native() : null;
        lock (gate)
        {
            if (value is NativeState state)
            {
                var busy = state.State is "working" or "waiting-answer" or "waiting-approval"; active[state.SessionId] = busy; clearTyping |= !busy && deliveredSession == state.SessionId; if (busy) lastActivity = Now;
                var previous = observations.LastOrDefault(); if (previous is not null && !ReferenceEquals(previous, publishing) && previous.SessionId == state.SessionId && previous.State == state.State && state.State != "failed") observations.RemoveAt(observations.Count - 1);
                var observation = new RuntimeObservation("", state.SessionId, state.RoomId, state.Runtime, state.State, state.ObservedAt, current?.LastActivityAt ?? lastActivity, current?.HistoryAvailable, mode == NativeHistoryMode.Shared ? "shared" : "per-room", maximum(), state.Settings, state.ErrorMessage);
                latest[state.SessionId] = observation; observations.Add(observation);
            }
            else if (value is NativeOutput text)
            {
                lastActivity = Now; var position = 0; var stream = text.StreamId is null ? null : WireJson.Compact(WireJson.Array(writer => { writer.WriteStringValue(text.SessionId); writer.WriteStringValue(text.StreamId); }));
                foreach (var part in messaging.NoticeChunks(text.Text))
                {
                    var id = Identity.Hash(WireJson.Compact(WireJson.Array(writer => { writer.WriteStringValue(text.SessionId); writer.WriteStringValue(text.Id); writer.WriteNumberValue(position++); }))); if (!sources.Add(id)) continue;
                    var previous = output.LastOrDefault(); if (stream is not null && previous?.StreamId == stream && !previous.Sealed && messaging.NoticeFits(previous.Text + part)) output[^1] = previous with { Text = previous.Text + part, Sources = [..previous.Sources, id] }; else output.Add(new(id, part, [id], stream, false));
                }
            }
            Save();
        }
    }
    public void Start(string id)
    {
        TaskCompletionSource? launch = null;
        lock (gate)
        {
            if (closing is not null) return;
            if (run != id) { foreach (var value in latest.Values) if (!observations.Any(pending => !ReferenceEquals(pending, publishing) && pending.SessionId == value.SessionId && pending.ObservedAt == value.ObservedAt)) observations.Add(value with { }); Save(); }
            run = id; if (running is null) { launch = new(TaskCreationOptions.RunContinuationsAsynchronously); running = launch.Task; }
        }
        if (launch is not null) _ = Run(launch);
        signal.Wake();
        async Task Run(TaskCompletionSource completion) { try { await Loop(); completion.TrySetResult(); } catch (Exception error) { completion.TrySetException(error); } }
    }
    private async Task Loop()
    {
        try
        {
            while (!lifetime.IsCancellationRequested)
            {
                bool clear; lock (gate) { clear = clearTyping; clearTyping = false; } if (clear) await ClearTyping();
                var result = await Flush(lifetime.Token); if (!result.IsSuccess && result.Error.Code is not ("unavailable" or "native" or "rate_limit" or "limit")) { failed(result.Error); return; }
                await signal.Wait(TimeSpan.FromSeconds(1), clock, lifetime.Token);
            }
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch (Exception error) { if (!lifetime.IsCancellationRequested) failed(new("unavailable", "Owner observation publication stopped: " + error.Message)); }
    }
    public async ValueTask<Result<Unit>> Flush(CancellationToken cancellation)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15), clock); using var scope = CancellationTokenSource.CreateLinkedTokenSource(cancellation, deadline.Token);
        var state = await AgentIO.Boundary(async () =>
        {
            for (;;)
            {
                RuntimeObservation? item; string? id; lock (gate) { id = run; item = observations.FirstOrDefault(); publishing = item; } if (id is null || item is null) break;
                var result = await coordination.Agent("reportRuntime", profile.Id, AgentWire.Observation(item), scope.Token, new Dictionary<string, string> { ["runId"] = id });
                lock (gate) { publishing = null; if (result.IsSuccess || result.Error.Code == "conflict") { if (ReferenceEquals(observations.FirstOrDefault(), item)) observations.RemoveAt(0); Save(); } }
                if (!result.IsSuccess && result.Error.Code != "conflict") return Result<Unit>.Fail(result.Error);
            }
            for (;;)
            {
                Output? item; lock (gate) { if (run is null || output.Count == 0) break; item = output[0]; if (!item.Sealed) { item = item with { Sealed = true }; output[0] = item; Save(); } }
                var room = await OwnerAuthority.Conversation(coordination, messaging, profile, scope.Token); if (!room.IsSuccess) return Result<Unit>.Fail(room.Error);
                var response = await messaging.SendNotice(room.Value, "observation-" + item.Id, item.Text, scope.Token); if (!response.IsSuccess) return Result<Unit>.Fail(response.Error);
                lock (gate) { if (!ReferenceEquals(output.FirstOrDefault(), item)) throw new InvalidOperationException("Owner output changed during publication"); output.RemoveAt(0); foreach (var source in item.Sources) sources.Remove(source); Save(); }
            }
            return Results.Done();
        });
        return state;
    }
    private async ValueTask<Result<Unit>> Typing(string room, bool enabled, CancellationToken cancellation)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10), clock); using var scope = CancellationTokenSource.CreateLinkedTokenSource(cancellation, deadline.Token);
        return await messaging.Thinking(room, profile.Account.UserId, enabled, 30000, scope.Token);
    }
    public async ValueTask<Result<Unit>> Delivered(string room, string session)
    {
        await typing.WaitAsync(); try
        {
            string? previous; bool enabled; long generation; lock (gate) { generation = ++typingGeneration; typingTimer?.Dispose(); typingTimer = null; previous = typingRoom; deliveredSession = session; enabled = !lifetime.IsCancellationRequested && active.GetValueOrDefault(session); typingRoom = enabled ? room : null; }
            if (previous is not null) await Typing(previous, false, CancellationToken.None); if (!enabled) return Results.Done(); var result = await Typing(room, true, lifetime.Token);
            lock (gate) if (generation == typingGeneration) typingTimer = clock.CreateTimer(_ => { lock (gate) if (generation == typingGeneration) { typingRoom = null; typingTimer?.Dispose(); typingTimer = null; } }, null, TimeSpan.FromSeconds(30), Timeout.InfiniteTimeSpan);
            return result.IsSuccess || result.Error.Code is "forbidden" or "unavailable" ? Results.Done() : result;
        }
        finally { typing.Release(); }
    }
    private async Task ClearTyping()
    {
        await typing.WaitAsync(); try { string? room; lock (gate) { ++typingGeneration; typingTimer?.Dispose(); typingTimer = null; room = typingRoom; typingRoom = null; } if (room is not null) await Typing(room, false, CancellationToken.None); } finally { typing.Release(); }
    }
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected; lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; }
        if (completion is not null) _ = Finish(completion); return new(selected);
        async Task Finish(TaskCompletionSource result) { try { await Close(); result.TrySetResult(); } catch (Exception error) { result.TrySetException(error); } }
    }
    private async Task Close()
    {
        List<Exception> errors = []; async Task Finish(Func<Task> action) { try { await action(); } catch (Exception error) { errors.Add(error); } }
        await Finish(lifetime.CancelAsync); signal.Wake(); var pending = running; if (pending is not null) await Finish(() => pending); await Finish(ClearTyping);
        try { await Finish(async () => { await Flush(CancellationToken.None); }); } finally { signal.Dispose(); typing.Dispose(); lifetime.Dispose(); }
        if (errors.Count != 0) throw new AggregateException("Owner observation shutdown requires inspection", errors);
    }
}
