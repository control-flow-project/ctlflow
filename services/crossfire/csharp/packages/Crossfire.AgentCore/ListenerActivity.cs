using System.Text.Json;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed class ListenerActivity : IAsyncDisposable
{
    private readonly Coordination coordination;
    private readonly string agent, release;
    private readonly ListenerController controller;
    private readonly ListenerStatistics statistics;
    private readonly TimeProvider clock;
    private readonly CancellationTokenSource lifetime, failed = new();
    private readonly Action<string> log;
    private readonly Action<string>? update;
    private Task running = Task.CompletedTask;
    private long messages;
    private bool unavailable;
    private string? warned;
    private readonly object gate = new();
    private Task? closing;
    public string RunId { get; } = Identity.Identifier();
    public CancellationToken Failed => failed.Token;
    public Failure? Error { get; private set; }
    private ListenerActivity(Coordination coordination, string agent, string release, ListenerController controller, ListenerStatistics statistics, TimeProvider clock, CancellationToken stop, Action<string> log, Action<string>? update)
    { this.coordination = coordination; this.agent = agent; this.release = release; this.controller = controller; this.statistics = statistics; this.clock = clock; lifetime = CancellationTokenSource.CreateLinkedTokenSource(stop, failed.Token); this.log = log; this.update = update; }
    public static async ValueTask<Result<ListenerActivity>> Start(Coordination coordination, string agent, string release, ListenerController controller, ListenerStatistics statistics, TimeProvider clock, CancellationToken stop, Action<string> log, Action<string>? update = null)
    {
        var value = new ListenerActivity(coordination, agent, release, controller, statistics, clock, stop, log, update); var reported = await value.Report(false, true);
        if (!reported.IsSuccess) { value.lifetime.Dispose(); value.failed.Dispose(); return Result<ListenerActivity>.Fail(reported.Error); }
        value.running = value.Loop(); return Result<ListenerActivity>.Success(value);
    }
    public void Delivered(int count) { if (count < 0) throw new ArgumentOutOfRangeException(nameof(count)); var total = Interlocked.Add(ref messages, count); if (total > Contracts.Validation.MaxWireInteger) throw new OverflowException("Invalid delivered message count"); }
    private async ValueTask<Result<Unit>> Report(bool stopped, bool initial = false)
    {
        var batch = statistics.Batch(stopped); var input = WireJson.Object(writer =>
        {
            writer.WriteString("release", release); writer.WriteNumber("messagesDelivered", Interlocked.Read(ref messages)); writer.WriteBoolean("stopped", stopped); writer.WriteStartObject("controller"); writer.WriteString("fleetId", controller.FleetId); writer.WriteString("connectionId", controller.ConnectionId); writer.WriteString("credential", controller.CredentialId); writer.WriteEndObject(); writer.WritePropertyName("statistics"); if (batch is null) writer.WriteNullValue(); else AgentWire.Statistics(batch).WriteTo(writer);
        });
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15), clock); using var scope = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token, stopped ? CancellationToken.None : lifetime.Token);
        var response = await coordination.Agent("reportListener", agent, input, scope.Token, new Dictionary<string, string> { ["runId"] = RunId });
        if (!response.IsSuccess)
        {
            if (initial) return Result<Unit>.Fail(response.Error);
            if (!stopped && response.Error.Code is "invalid" or "unauthorized" or "forbidden" or "missing" or "conflict") { Error = response.Error; failed.Cancel(); }
            if (!lifetime.IsCancellationRequested && !unavailable) log("Crossfire heartbeat unavailable; management will show offline when it expires."); unavailable = true; return Results.Done();
        }
        var value = response.Value;
        if (!value.TryGetProperty("statisticsAccepted", out var accepted) || accepted.ValueKind is not (JsonValueKind.True or JsonValueKind.False) || !value.TryGetProperty("disconnect", out var disconnect) || disconnect.ValueKind is not (JsonValueKind.True or JsonValueKind.False) || WireJson.Text(value, "currentRelease") is not { } current) return Results.Fail<Unit>("invalid", "Invalid listener heartbeat response");
        if (accepted.GetBoolean()) statistics.Acknowledge(batch);
        if (!stopped) { update?.Invoke(current); if (current != release && warned != current) { warned = current; log("Crossfire release " + current + " is available. Ask the owner to update the fleet controller and review changed skills; this listener remains running."); } }
        unavailable = false; if (disconnect.GetBoolean() && !stopped) { Error = new("unavailable", "Listener admission expired; reconnect its controller lease"); failed.Cancel(); } return Results.Done();
    }
    private async Task Loop()
    {
        try { while (!lifetime.IsCancellationRequested) { await Task.Delay(TimeSpan.FromSeconds(30), clock, lifetime.Token); var result = await Report(false); if (!result.IsSuccess) { Error = result.Error; failed.Cancel(); } } }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch (Exception error) when (error is IOException or InvalidDataException or JsonException or InvalidOperationException) { Error = new("unavailable", "Listener heartbeat failed: " + error.Message); failed.Cancel(); }
    }
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected; lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; } if (completion is not null) _ = Finish(completion); return new(selected);
        async Task Finish(TaskCompletionSource result) { try { await Close(); result.TrySetResult(); } catch (Exception error) { result.TrySetException(error); } }
    }
    private async Task Close()
    {
        List<Exception> errors = []; try { await lifetime.CancelAsync(); } catch (Exception error) { errors.Add(error); }
        try { await running; } catch (Exception error) { errors.Add(error); }
        try { await Report(true); } catch (Exception error) { errors.Add(error); } finally { lifetime.Dispose(); failed.Dispose(); }
        if (errors.Count != 0) throw new AggregateException("Listener activity shutdown requires inspection", errors);
    }
}
