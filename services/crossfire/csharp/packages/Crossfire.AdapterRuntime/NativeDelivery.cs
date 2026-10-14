using Crossfire.AgentCore;
using Crossfire.Kernel;

namespace Crossfire.AdapterRuntime;

public enum NativeReceipt { Received, Pending, Cancelled, Interrupted, Waiting }
public sealed record PublicationPorts<T>(string SessionId, RuntimeApproval Approval, CancellationToken Lifetime,
    Func<CancellationToken, ValueTask<Result<Unit>>> Verify, Func<ValueTask<Result<bool>>> Inspect,
    Func<string, string, CancellationToken, ValueTask<Result<T>>> Prepare,
    Func<T, Func<T, Result<Unit>>, ValueTask<Result<Unit>>> Publish,
    Func<T, Func<T, Result<Unit>>, CancellationToken, bool, ValueTask<Result<NativeReceipt>>> Received,
    Func<ValueTask> Close, Func<T, ValueTask<Result<bool>>>? Cancel = null,
    Func<int, CancellationToken, ValueTask>? Wait = null) where T : NativeMessage;

public sealed class NativeDelivery<T> : RuntimeConnection where T : NativeMessage
{
    private readonly PublicationPorts<T> native;
    private readonly NativeJournal<T> journal;
    private readonly int poll;
    private readonly int timeout;
    private readonly TimeProvider time;
    private readonly string? restored;
    private int operating;
    private readonly TaskCompletionSource drained = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly object gate = new();
    private Task? closing;
    private bool closed;
    public string SessionId => native.SessionId;
    public RuntimeApproval Approval => native.Approval;
    public CancellationToken Lifetime => native.Lifetime;
    public TurnControl? TurnControl => null;
    public RuntimeLifecycle? Lifecycle => null;
    public bool Unsettled => Volatile.Read(ref operating) != 0 || journal.Unsettled;
    private NativeDelivery(PublicationPorts<T> native, NativeJournal<T> journal, int poll, int timeout, TimeProvider time)
    { this.native = native; this.journal = journal; this.poll = poll; this.timeout = timeout; this.time = time; restored = journal.Pending?.MessageId; }
    public static Result<NativeDelivery<T>> Open(PublicationPorts<T> native, NativeCodec<T> codec, string file, int pollMs, int timeoutMs = 30000, TimeProvider? time = null)
    {
        if (pollMs is < 100 or > 30000 || timeoutMs is < 100 or > 300000) return Results.Fail<NativeDelivery<T>>("invalid", "Native polling and receipt deadlines must be finite");
        var journal = NativeJournal<T>.Open(file, native.SessionId, codec);
        return journal.IsSuccess ? Result<NativeDelivery<T>>.Success(new(native, journal.Value, pollMs, timeoutMs, time ?? TimeProvider.System)) : Result<NativeDelivery<T>>.Fail(journal.Error);
    }
    private Result<Unit> Retain(T input) => journal.Prepare(input);
    private async ValueTask<Result<NativeReceipt?>> SettlePending(CancellationToken cancellation)
    {
        if (journal.Pending is null) return Result<NativeReceipt?>.Success(null);
        var since = time.GetTimestamp();
        for (;;)
        {
            cancellation.ThrowIfCancellationRequested(); var verified = await native.Verify(cancellation); if (!verified.IsSuccess) return Result<NativeReceipt?>.Fail(verified.Error);
            var input = journal.Pending; if (input is null) return Results.Fail<NativeReceipt?>("invalid", "Native publication evidence disappeared before confirmation");
            var response = await native.Received(input, Retain, cancellation, input.MessageId == restored); if (!response.IsSuccess) return Result<NativeReceipt?>.Fail(response.Error);
            cancellation.ThrowIfCancellationRequested(); var received = response.Value;
            if (received is NativeReceipt.Received or NativeReceipt.Cancelled or NativeReceipt.Interrupted)
            { var saved = journal.Complete(input, received == NativeReceipt.Received); return saved.IsSuccess ? Result<NativeReceipt?>.Success(received) : Result<NativeReceipt?>.Fail(saved.Error); }
            if (received == NativeReceipt.Waiting) since = time.GetTimestamp();
            var remaining = timeout - time.GetElapsedTime(since).TotalMilliseconds;
            if (remaining <= 0) return Results.Fail<NativeReceipt?>("unavailable", "Native publication remains uncertain; its journal prevents resubmission and read positions are unchanged");
            var interval = (int)Math.Min(poll, Math.Max(1, remaining));
            if (native.Wait is not null) await native.Wait(interval, cancellation); else await Task.Delay(TimeSpan.FromMilliseconds(interval), time, cancellation);
        }
    }
    private async ValueTask<Result<TResult>> Exclusive<TResult>(Func<CancellationToken, ValueTask<Result<TResult>>> action, CancellationToken cancellation, bool cancelPending = false)
    {
        lock (gate)
        {
            if (closed) return Results.Fail<TResult>("unavailable", "Native delivery owner is closed");
            if (Interlocked.CompareExchange(ref operating, 1, 0) != 0) return Results.Fail<TResult>("conflict", "Native publication and receipt recovery must be sequential");
        }
        using var linked = cancellation.CanBeCanceled ? CancellationTokenSource.CreateLinkedTokenSource(Lifetime, cancellation) : null;
        try { return await action(linked?.Token ?? Lifetime); }
        catch (OperationCanceledException)
        {
            if (cancelPending)
            {
                var cancelled = await CancelPending(linked?.Token ?? Lifetime); if (!cancelled.IsSuccess) return Result<TResult>.Fail(cancelled.Error);
            }
            return Results.Fail<TResult>("unavailable", "Native publication stopped before confirmation; read positions are unchanged");
        }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or System.Text.Json.JsonException)
        { return Results.Fail<TResult>("native", "Native publication evidence cannot be verified; its original journal and unread positions are retained: " + error.Message); }
        finally { Interlocked.Exchange(ref operating, 0); lock (gate) if (closed) drained.TrySetResult(); }
    }
    public async ValueTask<Result<bool>> Inspect() => Lifetime.IsCancellationRequested ? Results.Fail<bool>("unavailable", "Native connection ended") : await native.Inspect();
    public ValueTask<Result<bool>> Settle(CancellationToken cancellation = default)
        => Exclusive(async scope => (await SettlePending(scope)).Map(value => value == NativeReceipt.Received), cancellation);
    public ValueTask<Result<bool>> Recover(string text, string messageId, CancellationToken cancellation = default)
        => Exclusive(async scope =>
        {
            var pending = journal.Pending;
            if (pending is null) return journal.Confirmed(text, messageId);
            if (pending.Text != text || pending.MessageId != messageId) return Results.Fail<bool>("conflict", "Receipt recovery does not match the pending native input");
            return (await SettlePending(scope)).Map(value => value == NativeReceipt.Received);
        }, cancellation);
    public ValueTask<Result<Unit>> Deliver(string text, string messageId, CancellationToken cancellation = default, InputPriority? priority = null)
        => Exclusive(async scope =>
        {
            scope.ThrowIfCancellationRequested(); var pending = journal.Pending;
            if (pending is not null && (pending.Text != text || pending.MessageId != messageId)) return Results.Fail<Unit>("conflict", "Settle the preceding native delivery before submitting different input");
            for (;;)
            {
                scope.ThrowIfCancellationRequested(); var confirmed = journal.Confirmed(text, messageId); if (!confirmed.IsSuccess) return Result<Unit>.Fail(confirmed.Error); if (confirmed.Value) return Results.Done();
                var input = journal.Pending;
                if (input is null)
                {
                    var verified = await native.Verify(scope); if (!verified.IsSuccess) return verified;
                    var prepared = await native.Prepare(text, messageId, scope); if (!prepared.IsSuccess) return Result<Unit>.Fail(prepared.Error); input = prepared.Value;
                    if (input.Text != text || input.MessageId != messageId) return Results.Fail<Unit>("invalid", "Native input preparation changed its identity or content");
                    scope.ThrowIfCancellationRequested(); var saved = journal.Prepare(input); if (!saved.IsSuccess) return saved;
                    var published = await native.Publish(input, Retain); if (!published.IsSuccess) { var cancelled = await CancelPending(scope); return cancelled.IsSuccess ? published : cancelled; }
                }
                var result = await SettlePending(scope); if (!result.IsSuccess) { var cancelled = await CancelPending(scope); return cancelled.IsSuccess ? Result<Unit>.Fail(result.Error) : cancelled; }
                if (result.Value == NativeReceipt.Received) return Results.Done();
                if (result.Value != NativeReceipt.Interrupted) return Results.Fail<Unit>("unavailable", "Native input was cancelled before publication; read positions are unchanged");
            }
        }, cancellation, cancelPending: true);
    private async ValueTask<Result<Unit>> CancelPending(CancellationToken scope)
    {
        var pending = journal.Pending;
        if (native.Lifetime.IsCancellationRequested || !scope.IsCancellationRequested || native.Cancel is null || pending is null) return Results.Done();
        var cancelled = await native.Cancel(pending); if (!cancelled.IsSuccess) return Result<Unit>.Fail(cancelled.Error);
        return cancelled.Value ? journal.Complete(pending, false) : Results.Done();
    }
    public Result<Unit> Acknowledge(IReadOnlyList<string> messageIds) => journal.Acknowledge(messageIds);
    public ValueTask<Result<RuntimeConnection>> Conversation(string room, InputAdmission? admission = null) => ValueTask.FromResult(Result<RuntimeConnection>.Success(this));
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected;
        lock (gate) { if (closing is null) { closed = true; completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; }
        if (completion is not null) _ = Close(completion); return new(selected);
    }
    private async Task Close(TaskCompletionSource completion)
    {
        try { await native.Close(); if (Volatile.Read(ref operating) != 0) await drained.Task; journal.Dispose(); completion.TrySetResult(); }
        catch (Exception error) { journal.Dispose(); completion.TrySetException(error); }
    }
}
