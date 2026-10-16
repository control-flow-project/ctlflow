using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;
using Fleetd.Storage;

namespace Fleetd.AdapterExecution;

public sealed record StopActivity(string Agent, string Run, ListenerController Binding, Func<ListenerController> Current);
public sealed class FleetReports : IAsyncDisposable
{
    private sealed record StopEntry(StopActivity Activity, string? Receipt, bool Confirmed, string? Error);
    private readonly LocalState storage;
    private readonly string file, fleet;
    private readonly Coordination coordination;
    private readonly TimeProvider clock;
    private readonly Func<bool> connected;
    private readonly object gate = new();
    private readonly List<JsonElement> failures = [];
    private readonly HashSet<string> episodes = new(StringComparer.Ordinal);
    private readonly Dictionary<string, StopEntry> stops = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim flush = new(1, 1);
    private readonly CancellationTokenSource lifetime;
    private readonly Task running;
    private Task? closing;
    private string? failureError;
    private bool dirty;
    public FleetReports(LocalState storage, string directory, string fleet, Coordination coordination, TimeProvider clock, Func<bool> connected, CancellationToken stop)
    {
        this.storage = storage; file = Path.Combine(directory, ".fleet", "failures.json"); this.fleet = fleet; this.coordination = coordination; this.clock = clock; this.connected = connected;
        if (storage.Exists(file))
        {
            var values = AgentIO.Read(storage, file, 33554432); if (values.ValueKind != JsonValueKind.Array || values.GetArrayLength() > 4096) throw new InvalidDataException("Invalid controller failure journal");
            foreach (var value in values.EnumerateArray()) { if (!Validation.Fields(value, ["episodeId", "agentId", "sessionId", "message"]).IsSuccess || WireJson.Text(value, "episodeId") is not { } id || !Validation.Identifier(id) || WireJson.Text(value, "agentId") is not { } agent || !Validation.Identifier(agent) || !Validation.NullableText(value.GetProperty("sessionId"), 255).IsSuccess || !Validation.PlainText(value.GetProperty("message"), 4000).IsSuccess) throw new InvalidDataException("Invalid controller failure report"); failures.Add(value.Clone()); episodes.Add(agent); }
        }
        lifetime = CancellationTokenSource.CreateLinkedTokenSource(stop); running = Loop();
    }
    private void Save() { AgentIO.Write(storage, file, WireJson.Array(writer => { foreach (var value in failures) value.WriteTo(writer); }), 33554432); dirty = false; }
    public Result<Unit> Failure(string agent, string? session, Failure error) => ConfigurationFiles.Boundary(() =>
    {
        lock (gate)
        {
            if (episodes.Contains(agent)) return Results.Done(); if (failures.Count >= 4096) return Results.Fail<Unit>("limit", "Resolve queued failure reports before starting further native work"); var message = TextRules.TruncateUtf8(error.Message, 4000);
            failures.Add(WireJson.Object(writer => { writer.WriteString("episodeId", Identity.Identifier()); writer.WriteString("agentId", agent); writer.WriteString("sessionId", session); writer.WriteString("message", message); })); episodes.Add(agent); dirty = true; Save(); return Results.Done();
        }
    });
    public void Recovered(string agent) { lock (gate) episodes.Remove(agent); }
    public StopActivity Activity(string agent, string run, ListenerController binding, Func<ListenerController> current)
    { lock (gate) { if (!stops.ContainsKey(agent) && stops.Count >= 100) throw new InvalidDataException("Native stop receipts exceed the fleet roster bound"); var value = new StopActivity(agent, run, binding, current); stops[agent] = new(value, null, false, null); return value; } }
    public void Closed(StopActivity activity) { lock (gate) if (stops.TryGetValue(activity.Agent, out var entry) && ReferenceEquals(entry.Activity, activity) && entry.Receipt is null) stops[activity.Agent] = entry with { Receipt = Identity.Identifier(), Error = "Native process closed; its stop receipt is awaiting Crossfire acknowledgment" }; }
    public void Forget(string agent) { lock (gate) stops.Remove(agent); }
    private static bool Current(StopEntry entry) => entry.Activity.Binding == entry.Activity.Current();
    public string? Error { get { StopEntry[] selected; string? failure; lock (gate) { failure = failureError; selected = stops.Values.ToArray(); } return failure ?? selected.FirstOrDefault(entry => entry.Receipt is not null && entry.Error is not null && Current(entry))?.Error; } }
    public async ValueTask<Result<Unit>> Confirm(string agent, CancellationToken cancellation)
    {
        await flush.WaitAsync(cancellation); try
        {
            StopEntry? entry; lock (gate) entry = stops.GetValueOrDefault(agent); if (entry is null) return Results.Done(); string? error = entry.Receipt is null ? "Native close is not confirmed for this authenticated listener run" : !Current(entry) ? "Native stop proof belongs to an expired controller generation; resume and stop the current binding before retirement" : lifetime.IsCancellationRequested || !connected() ? "Native process closed; its stop receipt is waiting for the original controller connection" : null;
            if (error is not null) { lock (gate) if (ReferenceEquals(stops.GetValueOrDefault(agent), entry)) stops[agent] = entry with { Error = error }; return Results.Fail<Unit>("conflict", error); } if (entry.Confirmed) return Results.Done();
            var result = await coordination.Call(new("recordFleetNativeStop", new Dictionary<string, string> { ["fleetId"] = fleet, ["agentId"] = agent }, WireJson.Object(writer => { writer.WriteString("connectionId", entry.Activity.Binding.ConnectionId); writer.WriteString("runId", entry.Activity.Run); writer.WriteString("receiptId", entry.Receipt); })), cancellation);
            if (result.IsSuccess && (!result.Value.TryGetProperty("recorded", out var recorded) || recorded.ValueKind != JsonValueKind.True)) result = Results.Fail<JsonElement>("conflict", "Crossfire did not accept the native stop receipt");
            var current = Current(entry); lock (gate)
            {
                if (!ReferenceEquals(stops.GetValueOrDefault(agent), entry)) return Results.Fail<Unit>("conflict", "New authenticated activity invalidated this native stop receipt");
                if (!result.IsSuccess) { stops[agent] = entry with { Error = result.Error.Message }; return Result<Unit>.Fail(result.Error); } if (!current) return Results.Fail<Unit>("conflict", "Native stop receipt authority changed during confirmation"); stops[agent] = entry with { Confirmed = true, Error = null }; return Results.Done();
            }
        }
        finally { flush.Release(); }
    }
    private async Task Loop()
    {
        try
        {
            while (!lifetime.IsCancellationRequested)
            {
                try
                {
                    JsonElement[] selected; StopEntry[] pending; lock (gate) { if (dirty) Save(); failureError = null; selected = failures.ToArray(); pending = stops.Values.ToArray(); } var closed = pending.Where(entry => entry.Receipt is not null && !entry.Confirmed && Current(entry)).Select(entry => entry.Activity.Agent).Take(4).ToArray();
                    foreach (var value in selected)
                    { var result = await coordination.Call(new("reportFleetFailure", new Dictionary<string, string> { ["fleetId"] = fleet }, value), lifetime.Token); if (!result.IsSuccess) { lock (gate) failureError = result.Error.Message; break; } lock (gate) { var id = WireJson.Text(value, "episodeId"); failures.RemoveAll(value => WireJson.Text(value, "episodeId") == id); dirty = true; Save(); } }
                    foreach (var agent in closed) await Confirm(agent, lifetime.Token);
                }
                catch (Exception error) when (error is IOException or InvalidDataException or InvalidOperationException or OperationCanceledException) { if (!lifetime.IsCancellationRequested) lock (gate) failureError = "Failure or stop receipt journal unavailable: " + error.Message; }
                await Task.Delay(TimeSpan.FromSeconds(1), clock, lifetime.Token);
            }
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
    }
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected; lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; } if (completion is not null) _ = Finish(completion); return new(selected);
        async Task Finish(TaskCompletionSource result)
        {
            List<Exception> errors = []; try { await lifetime.CancelAsync(); } catch (Exception error) { errors.Add(error); }
            try { await running; } catch (Exception error) { errors.Add(error); } finally { flush.Dispose(); lifetime.Dispose(); }
            if (errors.Count == 0) result.TrySetResult(); else result.TrySetException(new AggregateException("Controller reporting shutdown requires inspection", errors));
        }
    }
}
