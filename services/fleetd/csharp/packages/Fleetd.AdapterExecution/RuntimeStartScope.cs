using Crossfire.AgentCore;
using Crossfire.Kernel;

namespace Fleetd.AdapterExecution;

public sealed class RuntimeStartScope : OwnedRuntimeConnection
{
    private readonly OwnedRuntimeConnection native;
    private readonly CancellationTokenSource lifetime;
    private readonly object gate = new();
    private Task? closing;
    private RuntimeStartScope(OwnedRuntimeConnection native, CancellationTokenSource lifetime) { this.native = native; this.lifetime = lifetime; }
    public static async ValueTask<Result<OwnedRuntimeConnection>> Open(OwnedRuntimeAdapter adapter, OwnedRuntimeInput input, InputAdmission? admission, CancellationToken stop)
    {
        var lifetime = CancellationTokenSource.CreateLinkedTokenSource(stop); var transferred = false; var registration = admission?.Cancellation.Register(lifetime.Cancel);
        try
        {
            admission?.Cancellation.ThrowIfCancellationRequested(); var opened = await adapter.Start(input, lifetime.Token); if (!opened.IsSuccess) return opened;
            if (registration is { } registered) { await registered.DisposeAsync(); registration = null; }
            if (admission?.Cancellation.IsCancellationRequested == true || lifetime.IsCancellationRequested) { await opened.Value.DisposeAsync(); return Results.Fail<OwnedRuntimeConnection>("unavailable", "Immediate native startup was cancelled before admission"); }
            transferred = true; return Result<OwnedRuntimeConnection>.Success(new RuntimeStartScope(opened.Value, lifetime));
        }
        finally { if (registration is { } registered) await registered.DisposeAsync(); if (!transferred) lifetime.Dispose(); }
    }
    public string SessionId => native.SessionId;
    public RuntimeApproval Approval => native.Approval;
    public CancellationToken Lifetime => native.Lifetime;
    public TurnControl? TurnControl => native.TurnControl;
    public RuntimeLifecycle? Lifecycle => native.Lifecycle;
    public RuntimeAttachment? Attachment => native.Attachment;
    public ValueTask<Result<IReadOnlyList<ContextAttachment>>> Attachments() => native.Attachments();
    public ValueTask<Result<NativeActivity>> Activity() => native.Activity();
    public ValueTask<Result<ProviderState>> Provider(CancellationToken cancellation) => native.Provider(cancellation);
    public ValueTask<Result<bool>> Inspect() => native.Inspect();
    public ValueTask<Result<Unit>> Deliver(string text, string messageId, CancellationToken cancellation = default, InputPriority? priority = null) => native.Deliver(text, messageId, cancellation, priority);
    public ValueTask<Result<bool>> Settle(CancellationToken cancellation = default) => native.Settle(cancellation);
    public ValueTask<Result<bool>> Recover(string text, string messageId, CancellationToken cancellation = default) => native.Recover(text, messageId, cancellation);
    public Result<Unit> Acknowledge(IReadOnlyList<string> messageIds) => native.Acknowledge(messageIds);
    public ValueTask<Result<RuntimeConnection>> Conversation(string room, InputAdmission? admission = null) => native.Conversation(room, admission);
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected; lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; } if (completion is not null) _ = Finish(completion); return new(selected);
        async Task Finish(TaskCompletionSource result) { try { await Close(); result.TrySetResult(); } catch (Exception error) { result.TrySetException(error); } }
    }
    private async Task Close() { try { await native.DisposeAsync(); } finally { lifetime.Dispose(); } }
}
