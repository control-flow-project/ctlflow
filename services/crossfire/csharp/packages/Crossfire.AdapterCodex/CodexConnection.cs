using System.Threading.Channels;
using Crossfire.AgentCore;
using Crossfire.AdapterRuntime;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public sealed class CodexConnection : RuntimeConnection, TurnControl
{
    private readonly CodexSession session;
    private readonly string receiptFile;
    private readonly int poll;
    private readonly int timeout;
    private readonly TimeProvider time;
    private readonly Action<RuntimeObservationEvent>? observe;
    private readonly Channel<bool> wake = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true });
    private NativeDelivery<CodexInput>? delivery;
    private long revision;
    private long checkedRevision;
    private int unavailable;
    private bool resumed;
    private string? retained;
    public string SessionId => session.SessionId;
    public RuntimeApproval Approval => session.Approval;
    public CancellationToken Lifetime => session.Lifetime;
    public TurnControl TurnControl => this;
    public RuntimeLifecycle? Lifecycle => null;
    public bool Unsettled => delivery!.Unsettled;
    private CodexConnection(CodexSession session, string file, int poll, int timeout, TimeProvider time, Action<RuntimeObservationEvent>? observe)
    { this.session = session; receiptFile = file; this.poll = poll; this.timeout = timeout; this.time = time; this.observe = observe; }
    public static Result<CodexConnection> Open(CodexSession session, string file, int pollMs, int timeoutMs = 30000, TimeProvider? time = null, Action<RuntimeObservationEvent>? observe = null)
    {
        var owner = new CodexConnection(session, file, pollMs, timeoutMs, time ?? TimeProvider.System, observe);
        var ports = new PublicationPorts<CodexInput>(session.SessionId, session.Approval, session.Lifetime, owner.Verify, owner.Inspect,
            owner.Prepare, owner.Publish, owner.Received, session.DisposeAsync, Wait: owner.Wait);
        var opened = NativeDelivery<CodexInput>.Open(ports, CodexInputCodec.Codec, file, pollMs, timeoutMs, time);
        if (!opened.IsSuccess) return Result<CodexConnection>.Fail(opened.Error); owner.delivery = opened.Value; return Result<CodexConnection>.Success(owner);
    }
    public async ValueTask<Result<Unit>> Verify(CancellationToken cancellation)
    {
        var state = await CodexTimeline.State(session, cancellation);
        return !state.IsSuccess ? Result<Unit>.Fail(state.Error) : state.Value == "notLoaded" ? Results.Fail<Unit>("native", "The selected native session is not loaded for direct input; delivery stopped") : Results.Done();
    }
    public async ValueTask<Result<bool>> Inspect() => (await CodexTimeline.State(session, Lifetime)).Map(state => state == "active");
    public async ValueTask<Result<bool>> InspectSession(string sessionId) => (await CodexTimeline.State(session, Lifetime, sessionId)).Map(state => state == "active");
    private async ValueTask<Result<CodexInput>> Prepare(string text, string messageId, CancellationToken cancellation)
    {
        unavailable = 0; var captured = await CodexTimeline.Boundary(session, cancellation);
        return captured.Map(value => new CodexInput(null, text, messageId, value.Boundary, value.Initializing));
    }
    private async ValueTask<Result<string>> Start(CodexPublication input, CancellationToken cancellation)
    {
        var result = CodexJson.ObjectReply(await session.Protocol.Request("turn/start", CodexJson.Object(writer =>
        {
            writer.WriteString("threadId", SessionId); writer.WriteString("clientUserMessageId", input.MessageId); writer.WriteStartArray("input");
            writer.WriteStartObject(); writer.WriteString("type", "text"); writer.WriteString("text", input.Text); writer.WriteStartArray("text_elements"); writer.WriteEndArray(); writer.WriteEndObject(); writer.WriteEndArray();
        }), cancellation));
        if (!result.IsSuccess) return Result<string>.Fail(result.Error);
        var id = result.Value.TryGetProperty("turn", out var turn) ? CodexJson.String(turn, "id") : null;
        return string.IsNullOrEmpty(id) ? Results.Fail<string>("native", "Codex did not acknowledge a turn; delivery may be uncertain") : Result<string>.Success(id);
    }
    private async ValueTask<Result<Unit>> Publish(CodexInput input, Func<CodexInput, Result<Unit>> retain)
    {
        var turn = await Start(input.Published, Lifetime); return turn.IsSuccess ? retain(input with { Turn = turn.Value }) : Result<Unit>.Fail(turn.Error);
    }
    private async ValueTask<Result<NativeReceipt>> Received(CodexInput input, Func<CodexInput, Result<Unit>> retain, CancellationToken cancellation, bool restored)
    {
        Volatile.Write(ref checkedRevision, Interlocked.Read(ref revision));
        if (input.Resumption is not null && retained != input.MessageId) { ResumptionInput.Retain(input, receiptFile); retained = input.MessageId; }
        var published = input.Published; var result = await CodexTimeline.Receipt(session, published, cancellation);
        if (!result.IsSuccess)
        {
            if (published.Initializing && result.Error.Code == CodexTimeline.UnavailableMethod && ++unavailable < 3) return Result<NativeReceipt>.Success(NativeReceipt.Pending);
            return Result<NativeReceipt>.Fail(result.Error);
        }
        var checkedInput = result.Value;
        if (checkedInput.Status == "received")
        {
            if (input.Resumption is not null) observe?.Invoke(new NativeOutput(SessionId, input.Resumption.MessageId + "-verified", null,
                "The previous message could not be verified after restart. Its exact source and text were supplied to a new Codex turn, with instructions to review history, avoid repeating completed actions and continue unfinished work."));
            return Result<NativeReceipt>.Success(NativeReceipt.Received);
        }
        if (restored && !resumed || input.Resumption is not null && checkedInput.Status == "interrupted")
        {
            var state = await CodexTimeline.State(session, cancellation); if (!state.IsSuccess) return Result<NativeReceipt>.Fail(state.Error);
            if (state.Value == "idle")
            {
                resumed = true; var captured = await CodexTimeline.Boundary(session, cancellation); if (!captured.IsSuccess) return Result<NativeReceipt>.Fail(captured.Error);
                var next = new CodexPublication(null, ResumptionInput.Text(input, receiptFile, session.Workspace), "crossfire-resume-" + Identity.Identifier(), captured.Value.Boundary, captured.Value.Initializing);
                retained = input.MessageId; var saved = retain(input with { Resumption = next }); if (!saved.IsSuccess) return Result<NativeReceipt>.Fail(saved.Error);
                var started = await Start(next, cancellation); if (!started.IsSuccess) return Result<NativeReceipt>.Fail(started.Error);
                saved = retain(input with { Resumption = next with { Turn = started.Value } });
                return saved.Map(_ => NativeReceipt.Waiting);
            }
        }
        if (published.Turn is null) return Results.Fail<NativeReceipt>("unavailable", "Native input publication is uncertain; retained delivery journal prevents resubmission");
        if (published.Initializing || checkedInput.Boundary?.Key != published.Boundary?.Key)
        {
            var saved = input.Resumption is null ? retain(input with { Initializing = false, Boundary = checkedInput.Boundary })
                : retain(input with { Resumption = published with { Initializing = false, Boundary = checkedInput.Boundary } });
            if (!saved.IsSuccess) return Result<NativeReceipt>.Fail(saved.Error);
        }
        if (checkedInput.Status == "unavailable") return ++unavailable < 3 ? Result<NativeReceipt>.Success(NativeReceipt.Pending) : Results.Fail<NativeReceipt>("native", "Codex did not retain the accepted turn; read positions were not advanced");
        unavailable = 0;
        return checkedInput.Status switch { "interrupted" => Result<NativeReceipt>.Success(NativeReceipt.Interrupted), "missing" => Results.Fail<NativeReceipt>("native", "Codex finished without recording the input; read positions were not advanced"), _ => Result<NativeReceipt>.Success(NativeReceipt.Waiting) };
    }
    private async ValueTask Wait(int milliseconds, CancellationToken cancellation)
    {
        if (Interlocked.Read(ref revision) != Volatile.Read(ref checkedRevision)) return;
        while (wake.Reader.TryRead(out _)) { }
        if (Interlocked.Read(ref revision) != Volatile.Read(ref checkedRevision)) return;
        using var deadline = new CancellationTokenSource(TimeSpan.FromMilliseconds(milliseconds), time); using var stop = CancellationTokenSource.CreateLinkedTokenSource(cancellation, deadline.Token);
        try { await wake.Reader.ReadAsync(stop.Token); } catch (OperationCanceledException) when (!cancellation.IsCancellationRequested) { }
        cancellation.ThrowIfCancellationRequested();
    }
    public void Event(NativeEvent value)
    {
        if (CodexJson.String(value.Parameters, "threadId") != SessionId) return;
        if (value.Method == "thread/closed") throw new IOException("The selected Codex thread closed; listener delivery stopped");
        if (value.Method == "thread/status/changed")
        {
            if (Unsettled && CodexJson.String(value.Parameters.GetProperty("status"), "type") is not ("idle" or "active")) throw new IOException("The selected Codex thread is no longer available for input");
            Interlocked.Increment(ref revision); wake.Writer.TryWrite(true);
        }
        if (value.Method is "item/started" or "item/completed" && value.Parameters.TryGetProperty("item", out var item) && CodexJson.String(item, "type") == "userMessage")
        { Interlocked.Increment(ref revision); wake.Writer.TryWrite(true); }
    }
    public async ValueTask<Result<string?>> ActiveTurn(string? room = null, InputAdmission? admission = null)
    {
        var cancellation = admission?.Cancellation ?? Lifetime; var state = await CodexTimeline.State(session, cancellation); if (!state.IsSuccess) return Result<string?>.Fail(state.Error);
        if (state.Value == "idle") return Result<string?>.Success(null); if (state.Value != "active") return Results.Fail<string?>("native", "The selected native session is not loaded for turn inspection");
        var turn = await CodexTimeline.Latest(session, cancellation);
        if (!turn.IsSuccess && turn.Error.Code == CodexTimeline.Unmaterialized)
        { var current = await CodexTimeline.State(session, cancellation); if (current.IsSuccess && current.Value == "idle") return Result<string?>.Success(null); }
        return turn.Map(value => value?.Status == "inProgress" ? value.Id : null);
    }
    public async ValueTask<Result<string>> Interrupt(string turnId, bool recovery = false, InputAdmission? admission = null)
    {
        using var scope = admission is null ? null : CancellationTokenSource.CreateLinkedTokenSource(Lifetime, admission.Cancellation); var cancellation = scope?.Token ?? Lifetime;
        var state = await CodexTimeline.State(session, cancellation); if (!state.IsSuccess) return state;
        if (state.Value == "idle") return Result<string>.Success("inactive"); if (state.Value != "active") return Results.Fail<string>("native", "The selected native session is not loaded for interruption");
        var status = await CodexTimeline.TurnStatus(session, turnId, cancellation); if (!status.IsSuccess) return status;
        if (status.Value != "inProgress") return Result<string>.Success(status.Value == "interrupted" ? "interrupted" : "inactive");
        if (recovery) return Results.Fail<string>("unavailable", "Previous cancellation is uncertain and the captured turn is still active; inspect it before restarting the listener");
        var request = CodexJson.ObjectReply(await session.Protocol.Request("turn/interrupt", CodexJson.Object(writer => { writer.WriteString("threadId", SessionId); writer.WriteString("turnId", turnId); }), cancellation));
        if (!request.IsSuccess) { cancellation.ThrowIfCancellationRequested(); var current = await CodexTimeline.TurnStatus(session, turnId, cancellation); if (!current.IsSuccess || current.Value == "inProgress") return Result<string>.Fail(request.Error); }
        var since = time.GetTimestamp();
        for (;;)
        {
            var current = await CodexTimeline.TurnStatus(session, turnId, cancellation); if (!current.IsSuccess) return current;
            if (current.Value != "inProgress") return Result<string>.Success(current.Value == "interrupted" ? "interrupted" : "inactive");
            if (time.GetElapsedTime(since).TotalMilliseconds >= timeout) return Results.Fail<string>("unavailable", "Codex cancellation remains uncertain; refusing replacement input");
            await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(poll, 100)), time, cancellation);
        }
    }
    public ValueTask<Result<Unit>> Deliver(string text, string messageId, CancellationToken cancellation = default, InputPriority? priority = null) => delivery!.Deliver(text, messageId, cancellation, priority);
    public ValueTask<Result<bool>> Settle(CancellationToken cancellation = default) => delivery!.Settle(cancellation);
    public ValueTask<Result<bool>> Recover(string text, string messageId, CancellationToken cancellation = default) => delivery!.Recover(text, messageId, cancellation);
    public Result<Unit> Acknowledge(IReadOnlyList<string> messageIds) => delivery!.Acknowledge(messageIds);
    public ValueTask<Result<RuntimeConnection>> Conversation(string room, InputAdmission? admission = null) => ValueTask.FromResult(Result<RuntimeConnection>.Success(this));
    public ValueTask DisposeAsync() => delivery!.DisposeAsync();
}
