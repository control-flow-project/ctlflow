using System.Text.Json;
using System.Threading.Channels;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterRuntime;
using Crossfire.AgentCore;
using Crossfire.Kernel;

namespace Crossfire.AdapterPi;

public sealed class PiConnection : RuntimeConnection, TurnControl
{
    private sealed record ControlState(bool Idle, string? Leaf, string? Turn, string? Pending);
    private readonly PiProtocol native;
    private readonly string home;
    private readonly string history;
    private readonly string workspace;
    private readonly string receipt;
    private readonly RuntimeHooks hooks;
    private readonly TimeProvider time;
    private readonly Channel<bool> wake = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true });
    private NativeDelivery<PiInput>? delivery;
    private volatile PiInput? pending;
    private long revision;
    private long checkedRevision;
    private bool replayed;
    private volatile bool interrupted;
    public string SessionId { get; }
    public RuntimeApproval Approval => RuntimeApproval.None;
    public CancellationToken Lifetime => native.Lifetime;
    public TurnControl TurnControl => this;
    public RuntimeLifecycle? Lifecycle => null;
    public bool Unsettled => delivery!.Unsettled;
    private PiConnection(PiProtocol native, string home, string history, string workspace, string receipt, string session, RuntimeHooks hooks, Func<ValueTask> close, TimeProvider time)
    { this.native = native; this.home = home; this.history = history; this.workspace = workspace; this.receipt = receipt; SessionId = session; this.hooks = hooks; this.time = time; }
    public static Result<PiConnection> Open(PiProtocol native, string home, string history, string workspace, string receipt, string session, RuntimeHooks hooks,
        Func<ValueTask> close, TimeProvider? time = null)
    {
        var owner = new PiConnection(native, home, history, workspace, receipt, session, hooks, close, time ?? TimeProvider.System);
        var ports = new PublicationPorts<PiInput>(session, RuntimeApproval.None, native.Lifetime, owner.Verify, owner.Inspect, owner.Prepare, owner.Publish,
            owner.Received, close, _ => ValueTask.FromResult(Result<bool>.Success(false)), owner.Wait);
        var selected = NativeDelivery<PiInput>.Open(ports, PiInputCodec.Codec, receipt, 1000, time: time);
        if (!selected.IsSuccess) return Result<PiConnection>.Fail(selected.Error); owner.delivery = selected.Value; return Result<PiConnection>.Success(owner);
    }
    private async ValueTask<Result<ControlState>> State(CancellationToken cancellation)
    {
        var response = PiValues.ObjectReply(await native.Control("state", PiValues.Empty(), cancellation)); if (!response.IsSuccess) return Result<ControlState>.Fail(response.Error);
        var value = response.Value;
        if (PiValues.Text(value, "sessionId") != SessionId || !value.TryGetProperty("idle", out var idle) || idle.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
            || new[] { "leafId", "turn", "pending" }.Any(name => !value.TryGetProperty(name, out var item) || item.ValueKind is not (JsonValueKind.Null or JsonValueKind.String)))
            return Results.Fail<ControlState>("invalid", "Pi control does not match the exact native history");
        return Result<ControlState>.Success(new(idle.GetBoolean(), PiValues.Text(value, "leafId"), PiValues.Text(value, "turn"), PiValues.Text(value, "pending")));
    }
    public async ValueTask<Result<Unit>> Verify(CancellationToken cancellation)
    {
        try
        {
            cancellation.ThrowIfCancellationRequested(); var verified = PiState.Verify(home, history, workspace, SessionId); if (!verified.IsSuccess) return verified;
            return (await State(cancellation)).Map(_ => default(Unit));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        { return Results.Fail<Unit>("invalid", "The exact native Pi history cannot be verified: " + error.Message); }
    }
    public async ValueTask<Result<bool>> Inspect() => (await State(Lifetime)).Map(value => !value.Idle || value.Pending is not null);
    private ValueTask<Result<PiInput>> Prepare(string text, string messageId, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested(); interrupted = false; var boundary = NativeHistory.Capture(home, history);
        return ValueTask.FromResult(boundary is null ? Results.Fail<PiInput>("missing", "Pi history disappeared before native publication") : Result<PiInput>.Success(new(text, messageId, boundary, false)));
    }
    private async ValueTask<Result<Unit>> Publish(PiInput input, Func<PiInput, Result<Unit>> retain)
    {
        pending = input; var selected = input.Effective;
        var response = PiValues.ObjectReply(await native.Control("deliver", PiValues.Object(writer => { writer.WriteString("text", selected.Text); writer.WriteString("messageId", selected.MessageId); }), Lifetime));
        if (!response.IsSuccess) return Result<Unit>.Fail(response.Error);
        if (!response.Value.TryGetProperty("armed", out var armed) || armed.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return Results.Fail<Unit>("invalid", "Invalid native Pi publication result");
        if (!armed.GetBoolean()) return Results.Done();
        pending = input.Resumption is null ? input with { Published = true } : input with { Resumption = selected with { Published = true } }; return retain(pending);
    }
    private async ValueTask<Result<NativeReceipt>> Received(PiInput input, Func<PiInput, Result<Unit>> retain, CancellationToken cancellation, bool restored)
    {
        Volatile.Write(ref checkedRevision, Interlocked.Read(ref revision)); var response = await State(cancellation); if (!response.IsSuccess) return Result<NativeReceipt>.Fail(response.Error);
        var current = response.Value; var selected = input.Effective;
        if (input.Resumption is not null) ResumptionInput.Retain(input, receipt);
        if (PiReceipt.Received(home, history, selected.Boundary, selected, current.Leaf))
        {
            pending = null;
            if (input.Resumption is not null) hooks.Observe?.Invoke(new NativeOutput(SessionId, selected.MessageId + "-verified", null,
                "Native execution resumed with the exact last message retained as context. Earlier receipt could not be established; completed actions must not be repeated."));
            return Result<NativeReceipt>.Success(NativeReceipt.Received);
        }
        if (restored && !replayed && current.Idle && current.Pending is null)
        {
            var boundary = NativeHistory.Capture(home, history); if (boundary is null) return Results.Fail<NativeReceipt>("missing", "Pi history disappeared during restart recovery");
            var resumed = input with { Resumption = new(ResumptionInput.Text(input, receipt, workspace), Identity.Identifier(), boundary, false) };
            replayed = true; var saved = retain(resumed); if (!saved.IsSuccess) return Result<NativeReceipt>.Fail(saved.Error);
            return (await Publish(resumed, retain)).Map(_ => NativeReceipt.Waiting);
        }
        if (interrupted && !selected.Published) { pending = null; return Result<NativeReceipt>.Success(NativeReceipt.Interrupted); }
        if (!selected.Published && !restored && current.Idle && current.Pending is null)
        { var published = await Publish(input, retain); if (!published.IsSuccess) return Result<NativeReceipt>.Fail(published.Error); }
        return Result<NativeReceipt>.Success(current.Idle ? NativeReceipt.Pending : NativeReceipt.Waiting);
    }
    public void Changed() { Interlocked.Increment(ref revision); wake.Writer.TryWrite(true); }
    private async ValueTask Wait(int milliseconds, CancellationToken cancellation)
    {
        if (Interlocked.Read(ref revision) != Volatile.Read(ref checkedRevision)) return;
        while (wake.Reader.TryRead(out _)) { }
        if (Interlocked.Read(ref revision) != Volatile.Read(ref checkedRevision)) return;
        using var deadline = new CancellationTokenSource(TimeSpan.FromMilliseconds(milliseconds), time); using var scope = CancellationTokenSource.CreateLinkedTokenSource(cancellation, deadline.Token);
        try { await wake.Reader.ReadAsync(scope.Token); } catch (OperationCanceledException) when (!cancellation.IsCancellationRequested) { }
        cancellation.ThrowIfCancellationRequested();
    }
    public async ValueTask<Result<string?>> ActiveTurn(string? room = null, InputAdmission? admission = null) => (await State(admission?.Cancellation ?? Lifetime)).Map(value => value.Turn);
    public async ValueTask<Result<string>> Interrupt(string turnId, bool recovery = false, InputAdmission? admission = null)
    {
        var response = PiValues.ObjectReply(await native.Control("interrupt", PiValues.Object(writer => writer.WriteString("turn", turnId)), admission?.Cancellation ?? Lifetime));
        if (!response.IsSuccess) return Result<string>.Fail(response.Error);
        if (!response.Value.TryGetProperty("interrupted", out var result) || result.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return Results.Fail<string>("invalid", "Invalid native Pi captured interruption outcome");
        if (result.GetBoolean() && pending is not null && !pending.Effective.Published) interrupted = true;
        Changed(); return Result<string>.Success(result.GetBoolean() ? "interrupted" : "inactive");
    }
    public ValueTask<Result<Unit>> Deliver(string text, string messageId, CancellationToken cancellation = default, InputPriority? priority = null) => delivery!.Deliver(text, messageId, cancellation, priority);
    public ValueTask<Result<bool>> Settle(CancellationToken cancellation = default) => delivery!.Settle(cancellation);
    public ValueTask<Result<bool>> Recover(string text, string messageId, CancellationToken cancellation = default) => delivery!.Recover(text, messageId, cancellation);
    public Result<Unit> Acknowledge(IReadOnlyList<string> messageIds) => delivery!.Acknowledge(messageIds);
    public ValueTask<Result<RuntimeConnection>> Conversation(string room, InputAdmission? admission = null) => ValueTask.FromResult(Result<RuntimeConnection>.Success(this));
    public ValueTask DisposeAsync() => delivery!.DisposeAsync();
}
