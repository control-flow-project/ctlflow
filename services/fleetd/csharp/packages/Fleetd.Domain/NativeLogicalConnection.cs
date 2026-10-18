using Crossfire.AgentCore;
using Crossfire.Kernel;

namespace Fleetd.Domain;

public sealed partial class NativeLifecycle
{
    private sealed class Logical(NativeLifecycle owner, string context, string session) : RuntimeConnection, TurnControl
    {
        public string SessionId => session;
        public RuntimeApproval Approval => owner.services.Approval;
        public CancellationToken Lifetime => owner.lifetime.Token;
        public TurnControl TurnControl => this;
        public RuntimeLifecycle Lifecycle => owner;
        private async ValueTask<Result<RuntimeConnection>> Select(OwnedRuntimeConnection connection, InputAdmission? admission = null)
        {
            var selected = context == owner.services.Primary ? Result<RuntimeConnection>.Success(connection) : await connection.Conversation(context, admission);
            return selected.IsSuccess && selected.Value.SessionId != session ? Results.Fail<RuntimeConnection>("conflict", "The captured room history is not the resumed native history") : selected;
        }
        private async ValueTask<Result<T>> Call<T>(Func<OwnedRuntimeConnection, ValueTask<Result<T>>> operation, bool activity = false, InputAdmission? admission = null, bool prepare = true)
        {
            Interlocked.Increment(ref owner.activeCalls); if (activity) owner.Touch();
            try { var connected = await owner.Ensure(admission, prepare); if (!connected.IsSuccess) return Result<T>.Fail(connected.Error); admission?.Cancellation.ThrowIfCancellationRequested(); return await operation(connected.Value); }
            catch (OperationCanceledException) { return Results.Fail<T>("unavailable", "Native input is waiting for exact-history recovery or was cancelled before admission"); }
            finally { Interlocked.Decrement(ref owner.activeCalls); lock (owner.gate) owner.Schedule(); }
        }
        public async ValueTask<Result<bool>> Inspect()
        {
            var connection = owner.native; if (connection is null || connection.Lifetime.IsCancellationRequested) return Result<bool>.Success(owner.phase is "waking" or "failed" || Volatile.Read(ref owner.activeCalls) > 0);
            var result = await owner.InspectNative(connection); bool unsettled; lock (owner.gate) unsettled = owner.unsettled.Count != 0 || !ReferenceEquals(owner.native, connection) || connection.Lifetime.IsCancellationRequested; return result.Map(value => value || Volatile.Read(ref owner.activeCalls) > 0 || unsettled);
        }
        public ValueTask<Result<Unit>> Deliver(string text, string messageId, CancellationToken cancellation = default, InputPriority? priority = null)
        {
            cancellation.ThrowIfCancellationRequested(); lock (owner.gate) owner.unsettled[messageId] = context; InputAdmission? admission = priority is null ? null : new(priority.Value, cancellation);
            return Call(async connection => {
                var selected = await Select(connection, admission); if (!selected.IsSuccess) return Result<Unit>.Fail(selected.Error);
                cancellation.ThrowIfCancellationRequested(); var captured = owner.CaptureInput(context, session); if (!captured.IsSuccess) return captured;
                return await selected.Value.Deliver(text, messageId, cancellation, priority);
            }, true, admission);
        }
        public async ValueTask<Result<bool>> Recover(string text, string messageId, CancellationToken cancellation = default)
        {
            lock (owner.gate) owner.unsettled[messageId] = context; var result = await Call(async connection => { var selected = await Select(connection); return selected.IsSuccess ? await selected.Value.Recover(text, messageId, cancellation) : Result<bool>.Fail(selected.Error); }, true);
            if (result.IsSuccess && !result.Value) lock (owner.gate) { owner.unsettled.Remove(messageId); owner.Schedule(); } return result;
        }
        public ValueTask<Result<bool>> Settle(CancellationToken cancellation = default)
        {
            if (owner.native is null && owner.services.Hooks.PendingInput?.Invoke() != true && owner.services.Hooks.PendingDecisions?.Invoke() != true) return ValueTask.FromResult(Result<bool>.Success(false));
            return Call(async connection => { var selected = await Select(connection); return selected.IsSuccess ? await selected.Value.Settle(cancellation) : Result<bool>.Fail(selected.Error); });
        }
        public Result<Unit> Acknowledge(IReadOnlyList<string> messageIds)
        {
            if (messageIds.Count == 0) return Results.Done(); var connection = owner.native; if (connection is null || connection.Lifetime.IsCancellationRequested) return Results.Fail<Unit>("unavailable", "Exact native receipt acknowledgment is waiting for recovery");
            var result = connection.Acknowledge(messageIds); if (result.IsSuccess) lock (owner.gate) { foreach (var id in messageIds) owner.unsettled.Remove(id); owner.Schedule(); } return result;
        }
        public ValueTask<Result<string?>> ActiveTurn(string? room = null, InputAdmission? admission = null)
        {
            if (admission is not null) return Call(connection => connection.TurnControl is null ? ValueTask.FromResult(Results.Fail<string?>("invalid", "Native turn control is unavailable")) : connection.TurnControl.ActiveTurn(room, admission), admission: admission, prepare: false);
            var connection = owner.native; return connection is not null && !connection.Lifetime.IsCancellationRequested && connection.TurnControl is not null ? connection.TurnControl.ActiveTurn(room) : ValueTask.FromResult(Result<string?>.Success(null));
        }
        public ValueTask<Result<string>> Interrupt(string turnId, bool recovery = false, InputAdmission? admission = null)
            => Call(connection => connection.TurnControl is null ? ValueTask.FromResult(Results.Fail<string>("invalid", "Native turn control is unavailable")) : connection.TurnControl.Interrupt(turnId, recovery, admission), true, admission, false);
        public ValueTask<Result<RuntimeConnection>> Conversation(string room, InputAdmission? admission = null)
            => Call(async connection => { var selected = await connection.Conversation(room, admission); if (!selected.IsSuccess) return selected; var saved = owner.RefreshContexts(); return saved.IsSuccess ? Result<RuntimeConnection>.Success(new Logical(owner, room, selected.Value.SessionId)) : Result<RuntimeConnection>.Fail(saved.Error); }, admission: admission);
        public ValueTask DisposeAsync() => owner.DisposeAsync();
    }
}
