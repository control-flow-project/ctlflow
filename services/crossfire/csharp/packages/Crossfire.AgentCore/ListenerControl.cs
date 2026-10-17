using System.Text;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed record DirectedInput(string MessageId, string Text, long ExpiresAt);
public sealed record ListenerControlState(bool Connected, CancellationToken ConnectionGeneration, bool Active, CancellationToken Generation, DirectedInput? Input);
public sealed class ListenerControl : IDisposable
{
    private readonly object gate = new();
    private readonly Func<ListenerController> binding;
    private readonly Func<string, string, string?, CancellationToken, ValueTask<Result<Unit>>> acknowledge;
    private readonly Action<string>? unavailable;
    private CancellationTokenSource connection = new(), generation = new();
    private readonly List<CancellationTokenSource> retired = [];
    private bool connected, active;
    private DirectedInput? input;
    public event Action? Changed;
    public ListenerControl(Func<ListenerController> binding, Func<string, string, string?, CancellationToken, ValueTask<Result<Unit>>> acknowledge, Action<string>? unavailable = null)
    { this.binding = binding; this.acknowledge = acknowledge; this.unavailable = unavailable; connection.Cancel(); generation.Cancel(); }
    public ListenerController Binding() => binding();
    public ListenerControlState Current() { lock (gate) return new(connected, connection.Token, active, generation.Token, input); }
    public void Update(bool nextConnected, bool enabled, DirectedInput? next)
    {
        if (enabled && !nextConnected) throw new InvalidDataException("Delivery requires an authenticated controller connection");
        CancellationTokenSource? cancelConnection = null, cancelDelivery = null; bool different;
        lock (gate)
        {
            different = connected != nextConnected || active != enabled || input != next;
            if (connected && !nextConnected) cancelConnection = connection;
            if (!connected && nextConnected) { retired.Add(connection); connection = new(); }
            if (active && !enabled) cancelDelivery = generation;
            if (!active && enabled) { retired.Add(generation); generation = new(); }
            connected = nextConnected; active = enabled; input = next;
        }
        cancelConnection?.Cancel(); cancelDelivery?.Cancel(); if (different) Changed?.Invoke();
    }
    public void Unavailable(string reason) { Update(false, false, Current().Input); unavailable?.Invoke(reason); }
    public ValueTask<Result<Unit>> Acknowledge(string id, string status, string? error, CancellationToken cancellation) => acknowledge(id, status, error, cancellation);
    public async ValueTask WaitForActivation(CancellationToken cancellation)
    {
        if (Current().Active) return; var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously); void ChangedState() { if (Current().Active) ready.TrySetResult(); }
        Changed += ChangedState; try { ChangedState(); await ready.Task.WaitAsync(cancellation); } finally { Changed -= ChangedState; }
    }
    public void Dispose() { Update(false, false, null); connection.Dispose(); generation.Dispose(); foreach (var previous in retired) previous.Dispose(); }
}

public sealed class ControlledPublication(LocalState storage, string file, ListenerControl control, RuntimeConnection runtime, MessageArtifacts artifacts, Func<int> maximum, TimeProvider clock)
{
    private sealed record Saved(string Session, DirectedInput Input, string Text, string Stage);
    public bool Pending => storage.Exists(file) || control.Current().Input is not null;
    public bool Recovering => storage.Exists(file) && Load().Stage == "publishing";
    private Saved Load()
    {
        var value = AgentIO.Read(storage, file); if (!Validation.Fields(value, ["sessionId", "input", "text", "stage"]).IsSuccess || WireJson.Text(value, "sessionId") != runtime.SessionId) throw new InvalidDataException("Invalid or retargeted controller input checkpoint");
        var input = Parse(value.GetProperty("input")); var text = WireJson.Text(value, "text"); var stage = Validation.Choice(value.GetProperty("stage"), "queued", "publishing", "delivered");
        if (!input.IsSuccess || text is null || Encoding.UTF8.GetByteCount(text) > 98304 || !stage.IsSuccess) throw new InvalidDataException("Invalid controller input checkpoint"); return new(runtime.SessionId, input.Value, text, stage.Value);
    }
    public static Result<DirectedInput> Parse(JsonElement value)
    {
        if (!Validation.Fields(value, ["messageId", "text", "expiresAt"]).IsSuccess) return Results.Fail<DirectedInput>("invalid", "Invalid controller input");
        var id = Validation.Text(value.GetProperty("messageId"), 200); var text = Validation.PlainText(value.GetProperty("text"), 98304); var expires = Validation.Integer(value.GetProperty("expiresAt"));
        return id.IsSuccess && text.IsSuccess && expires.IsSuccess && Encoding.UTF8.GetByteCount(text.Value) <= 98304 ? Result<DirectedInput>.Success(new(id.Value, text.Value, expires.Value)) : Results.Fail<DirectedInput>("invalid", "Invalid controller input bounds");
    }
    private void Save(Saved value) => AgentIO.Write(storage, file, WireJson.Object(writer => { writer.WriteString("sessionId", value.Session); writer.WriteStartObject("input"); writer.WriteString("messageId", value.Input.MessageId); writer.WriteString("text", value.Input.Text); writer.WriteNumber("expiresAt", value.Input.ExpiresAt); writer.WriteEndObject(); writer.WriteString("text", value.Text); writer.WriteString("stage", value.Stage); }));
    private string Text(DirectedInput input) => artifacts.Input(input.Text, input.MessageId, maximum(), WireJson.Object(writer => { writer.WriteString("kind", "controller-input"); writer.WriteNumber("expiresAt", input.ExpiresAt); }));
    public ValueTask<Result<Unit>> Publish(CancellationToken cancellation) => AgentIO.Boundary(async () =>
    {
        var incoming = control.Current().Input; if (!storage.Exists(file) && incoming is null) return Results.Done(); var saved = storage.Exists(file) ? Load() : new Saved(runtime.SessionId, incoming!, Text(incoming!), "queued"); Save(saved);
        if (saved.Stage == "publishing") { var recovered = await runtime.Recover(saved.Text, saved.Input.MessageId, cancellation); if (!recovered.IsSuccess) return Result<Unit>.Fail(recovered.Error); saved = saved with { Stage = recovered.Value ? "delivered" : "queued" }; Save(saved); }
        if (saved.Stage != "delivered" && saved.Input.ExpiresAt <= clock.GetUtcNow().ToUnixTimeMilliseconds()) { var skipped = await control.Acknowledge(saved.Input.MessageId, "skipped", "Message expired before publication", cancellation); if (!skipped.IsSuccess) return skipped; artifacts.Release([saved.Input.MessageId]); storage.Remove(file); return Results.Done(); }
        if (saved.Stage != "delivered") { cancellation.ThrowIfCancellationRequested(); saved = saved with { Text = Text(saved.Input), Stage = "publishing" }; Save(saved); var sent = await runtime.Deliver(saved.Text, saved.Input.MessageId, cancellation); if (!sent.IsSuccess) return sent; saved = saved with { Stage = "delivered" }; Save(saved); }
        var accepted = await control.Acknowledge(saved.Input.MessageId, "delivered", null, cancellation); if (!accepted.IsSuccess) return accepted; var acknowledged = runtime.Acknowledge([saved.Input.MessageId]); if (!acknowledged.IsSuccess) return acknowledged; artifacts.Release([saved.Input.MessageId]); storage.Remove(file); return Results.Done();
    });
}
