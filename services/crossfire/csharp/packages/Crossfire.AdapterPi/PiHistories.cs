using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterRuntime;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterPi;

public sealed class PiHistories : OwnedRuntimeConnection, TurnControl
{
    private sealed record Opened(PiContext Context, CancellationTokenSource Lifetime, CancellationTokenRegistration Failed);
    private readonly string binary;
    private readonly string home;
    private readonly OwnedRuntimeInput input;
    private readonly PiOptions options;
    private readonly StateLock stateLock;
    private readonly string primary;
    private readonly CancellationTokenSource lifetime;
    private readonly CancellationToken token;
    private readonly object gate = new();
    private readonly Dictionary<string, Opened> opened = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Task<Result<PiConnection>>> starting = new(StringComparer.Ordinal);
    private PiRegistry registry;
    private PiConnection? selected;
    private Task? closing;
    private PiConnection Primary => selected ?? throw new InvalidOperationException("Native Pi primary context is not ready");
    public string SessionId => Primary.SessionId;
    public RuntimeApproval Approval => RuntimeApproval.None;
    public CancellationToken Lifetime => token;
    public TurnControl TurnControl => this;
    public RuntimeLifecycle? Lifecycle => null;
    public RuntimeAttachment? Attachment => null;
    public static string Receipt(string home, string context) => Path.Combine(home, "receipts", Identity.Hash(context) + ".json");
    private static string Mode(NativeHistoryMode mode) => mode == NativeHistoryMode.Shared ? "shared" : "per-room";
    private PiHistories(string binary, string home, StateLock stateLock, OwnedRuntimeInput input, PiOptions options, PiRegistry registry, CancellationToken cancellation)
    {
        this.binary = binary; this.home = home; this.stateLock = stateLock; this.input = input; this.options = options; this.registry = registry;
        primary = input.HistoryMode == NativeHistoryMode.Shared ? "shared" : "control"; lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellation); token = lifetime.Token;
    }
    public static async ValueTask<Result<OwnedRuntimeConnection>> Start(string binary, string home, StateLock stateLock, OwnedRuntimeInput input, PiOptions options, CancellationToken cancellation)
    {
        var loaded = PiState.Read(home); if (!loaded.IsSuccess) { stateLock.Dispose(); return Result<OwnedRuntimeConnection>.Fail(loaded.Error); }
        var owner = new PiHistories(binary, home, stateLock, input, options, loaded.Value, cancellation);
        try
        {
            var existing = PrivateFiles.Exists(Path.Combine(home, PiState.FileName));
            var changing = existing && loaded.Value.Mode != Mode(input.HistoryMode) && loaded.Value.Bindings.Any(binding => binding.Context == (loaded.Value.Mode == "shared" ? "shared" : "control"));
            if (owner.Binding(owner.primary) is null && !changing && (!input.AllowNewHistory || existing))
                return Results.Fail<OwnedRuntimeConnection>("missing", "Saved Pi history is missing; resume cannot create a new history. Use explicit fresh history if intended.");
            if (loaded.Value.Mode != Mode(input.HistoryMode))
            {
                if (input.Hooks.PendingDecisions?.Invoke() == true) return Results.Fail<OwnedRuntimeConnection>("conflict", "Resolve original Pi decisions before changing history mode");
                foreach (var context in owner.Contexts()) { var pending = owner.Unacknowledged(context); if (!pending.IsSuccess) return Result<OwnedRuntimeConnection>.Fail(pending.Error);
                    if (pending.Value) return Results.Fail<OwnedRuntimeConnection>("conflict", "Acknowledge native Pi publications before changing history mode"); }
            }
            var selected = await owner.Open(owner.primary); if (!selected.IsSuccess) return Result<OwnedRuntimeConnection>.Fail(selected.Error);
            if (owner.Lifetime.IsCancellationRequested) return Results.Fail<OwnedRuntimeConnection>("unavailable", "Pi history owner stopped before startup completed");
            owner.selected = selected.Value; return Result<OwnedRuntimeConnection>.Success(owner);
        }
        finally { if (owner.selected is null) await owner.DisposeAsync(); }
    }
    private string[] Contexts() { lock (gate) return registry.Bindings.Select(binding => binding.Context).ToArray(); }
    private PiBinding? Binding(string context) { lock (gate) return registry.Bindings.FirstOrDefault(binding => binding.Context == context); }
    private Result<Unit> Save(PiBinding binding)
    {
        lock (gate)
        {
            if (binding.SessionId is not null && registry.Bindings.Any(value => value.Context != binding.Context && value.SessionId == binding.SessionId)) return Results.Fail<Unit>("conflict", "Pi reused another native context identity");
            var next = new PiRegistry(Mode(input.HistoryMode), [.. registry.Bindings.Where(value => value.Context != binding.Context), binding]);
            var saved = PiState.Write(home, next); if (saved.IsSuccess) registry = next; return saved;
        }
    }
    private Result<bool> Unacknowledged(string context)
    {
        var file = Receipt(home, context); if (!PrivateFiles.Exists(file)) return Result<bool>.Success(false);
        var binding = Binding(context); if (binding?.SessionId is not { } session) return Results.Fail<bool>("invalid", "Pi publication journal has no exact native history");
        return NativeJournal<PiInput>.Read(file, session, PiInputCodec.Codec).Map(value => value.Pending is not null || value.Confirmed.Count != 0);
    }
    private ValueTask<Result<PiConnection>> Open(string context, InputAdmission? admission = null)
    {
        if (context is not ("shared" or "control") && !Validation.RoomId(context)) return ValueTask.FromResult(Results.Fail<PiConnection>("invalid", "Invalid native Pi context"));
        if (Lifetime.IsCancellationRequested || admission?.Cancellation.IsCancellationRequested == true) return ValueTask.FromResult(Results.Fail<PiConnection>("unavailable", "Pi context admission was cancelled"));
        TaskCompletionSource<Result<PiConnection>> completion;
        lock (gate)
        {
            if (closing is not null) return ValueTask.FromResult(Results.Fail<PiConnection>("unavailable", "Pi history owner stopped"));
            if (opened.TryGetValue(context, out var current)) return ValueTask.FromResult(Result<PiConnection>.Success(current.Context.Connection));
            if (starting.TryGetValue(context, out var pending)) return admission is null ? new(pending) : ValueTask.FromResult(Results.Fail<PiConnection>("unavailable", "Exact Pi room history is opening; immediate input has not been accepted"));
            completion = new(TaskCreationOptions.RunContinuationsAsynchronously); starting.Add(context, completion.Task);
        }
        _ = Initialize(context, admission, completion); return new(completion.Task);
    }
    private async Task Initialize(string context, InputAdmission? admission, TaskCompletionSource<Result<PiConnection>> completion)
    {
        var scope = CancellationTokenSource.CreateLinkedTokenSource(Lifetime); var cancelled = admission?.Cancellation.Register(() => scope.Cancel()) ?? default;
        PiContext? current = null; var retained = false; var result = Results.Fail<PiConnection>("native", "Pi native context did not initialize");
        try
        {
            var binding = Binding(context);
            if (binding is null)
            {
                lock (gate)
                {
                    if (registry.Bindings.Count >= 2002) { result = Results.Fail<PiConnection>("limit", "Pi room history budget is exhausted"); return; }
                    binding = PiState.Allocate(context); var allocated = Save(binding); if (!allocated.IsSuccess) { result = Result<PiConnection>.Fail(allocated.Error); return; }
                }
            }
            var initialized = PiState.ReadBinding(home, binding, input.Workspace, true); if (!initialized.IsSuccess) { result = Result<PiConnection>.Fail(initialized.Error); return; }
            var saved = Save(initialized.Value); if (!saved.IsSuccess) { result = Result<PiConnection>.Fail(saved.Error); return; }
            var selected = await PiContext.Open(binary, home, initialized.Value, input, options, scope.Token); if (!selected.IsSuccess) { result = Result<PiConnection>.Fail(selected.Error); return; } current = selected.Value;
            saved = Save(current.Binding); if (!saved.IsSuccess) { result = Result<PiConnection>.Fail(saved.Error); return; }
            scope.Token.ThrowIfCancellationRequested(); var failed = current.Connection.Lifetime.Register(() => lifetime.Cancel());
            lock (gate) { opened.Add(context, new(current, scope, failed)); retained = true; } result = Result<PiConnection>.Success(current.Connection);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException or ArgumentException or OperationCanceledException)
        { result = Results.Fail<PiConnection>("native", "Pi native history initialization failed: " + PiValues.ErrorText(error.Message)); }
        finally
        {
            try { await cancelled.DisposeAsync(); if (!retained) { if (current is not null) await current.DisposeAsync(); scope.Dispose(); } }
            catch (Exception error) { result = Results.Fail<PiConnection>("native", "Pi context cleanup failed: " + PiValues.ErrorText(error.Message)); }
            finally { lock (gate) starting.Remove(context); completion.TrySetResult(result); }
        }
    }
    public async ValueTask<Result<bool>> Inspect()
    {
        if (Lifetime.IsCancellationRequested) return Results.Fail<bool>("unavailable", "Pi history owner stopped");
        Opened[] initial; lock (gate) { if (starting.Count != 0 || input.Hooks.PendingDecisions?.Invoke() == true) return Result<bool>.Success(true); initial = opened.Values.ToArray(); }
        foreach (var context in Contexts())
        {
            Opened? current; lock (gate) opened.TryGetValue(context, out current);
            if (current is not null) { if (current.Context.Connection.Unsettled) return Result<bool>.Success(true); var busy = await current.Context.Connection.Inspect(); if (!busy.IsSuccess || busy.Value) return busy; }
            else { var pending = Unacknowledged(context); if (!pending.IsSuccess || pending.Value) return pending; }
        }
        lock (gate) return Result<bool>.Success(starting.Count != 0 || opened.Count != initial.Length || opened.Values.Any(value => value.Context.Connection.Unsettled));
    }
    public async ValueTask<Result<bool>> Settle(CancellationToken cancellation = default)
    {
        if (Lifetime.IsCancellationRequested) return Results.Fail<bool>("unavailable", "Pi history owner stopped");
        foreach (var context in Contexts()) { var pending = Unacknowledged(context); if (!pending.IsSuccess) return pending; if (pending.Value) { var selected = await Open(context); if (!selected.IsSuccess) return Result<bool>.Fail(selected.Error); } }
        Opened[] current; lock (gate) current = opened.Values.ToArray(); var received = false;
        foreach (var value in current) { var settled = await value.Context.Connection.Settle(cancellation); if (!settled.IsSuccess) return settled; received |= settled.Value; } return Result<bool>.Success(received);
    }
    public Result<Unit> Acknowledge(IReadOnlyList<string> ids)
    { lock (gate) { if (closing is not null) return Results.Fail<Unit>("unavailable", "Pi history owner stopped"); foreach (var value in opened.Values) { var saved = value.Context.Connection.Acknowledge(ids); if (!saved.IsSuccess) return saved; } } return Results.Done(); }
    public ValueTask<Result<Unit>> Deliver(string text, string messageId, CancellationToken cancellation = default, InputPriority? priority = null) => Primary.Deliver(text, messageId, cancellation, priority);
    public ValueTask<Result<bool>> Recover(string text, string messageId, CancellationToken cancellation = default) => Primary.Recover(text, messageId, cancellation);
    public async ValueTask<Result<RuntimeConnection>> Conversation(string room, InputAdmission? admission = null)
    { if (!Validation.RoomId(room)) return Results.Fail<RuntimeConnection>("invalid", "Supply an exact Matrix room identity"); return (await Open(input.HistoryMode == NativeHistoryMode.Shared ? "shared" : room, admission)).Map<RuntimeConnection>(value => value); }
    public ValueTask<Result<IReadOnlyList<ContextAttachment>>> Attachments() => ValueTask.FromResult(Result<IReadOnlyList<ContextAttachment>>.Success([]));
    public async ValueTask<Result<string?>> ActiveTurn(string? room = null, InputAdmission? admission = null)
    {
        var context = input.HistoryMode == NativeHistoryMode.Shared ? "shared" : room ?? "control"; PiConnection? selected;
        if (admission is not null) { var value = await Open(context, admission); if (!value.IsSuccess) return Result<string?>.Fail(value.Error); selected = value.Value; }
        else { lock (gate) selected = opened.GetValueOrDefault(context)?.Context.Connection; }
        return selected is null ? Result<string?>.Success(null) : (await selected.ActiveTurn(admission: admission)).Map(value => value is null ? null : "[" + ProtocolJson.Quote(context) + "," + ProtocolJson.Quote(value) + "]");
    }
    public async ValueTask<Result<string>> Interrupt(string turnId, bool recovery = false, InputAdmission? admission = null)
    {
        try
        {
            using var document = JsonDocument.Parse(turnId); var tuple = document.RootElement;
            if (tuple.ValueKind != JsonValueKind.Array || tuple.GetArrayLength() != 2 || tuple.EnumerateArray().Any(value => value.ValueKind != JsonValueKind.String) || Binding(tuple[0].GetString()!) is null)
                return Results.Fail<string>("invalid", "Invalid captured Pi history and execution");
            var selected = await Open(tuple[0].GetString()!, admission); return selected.IsSuccess ? await selected.Value.Interrupt(tuple[1].GetString()!, recovery, admission) : Result<string>.Fail(selected.Error);
        }
        catch (JsonException) { return Results.Fail<string>("invalid", "Invalid captured Pi history and execution"); }
    }
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected;
        lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; }
        if (completion is not null) _ = Close(completion); return new(selected);
    }
    private async Task Close(TaskCompletionSource completion)
    {
        var errors = new List<Exception>();
        try
        {
            try { await lifetime.CancelAsync(); } catch (Exception error) { errors.Add(error); }
            Task<Result<PiConnection>>[] pending; lock (gate) pending = starting.Values.ToArray(); try { await Task.WhenAll(pending); } catch (Exception error) { errors.Add(error); }
            Opened[] current; lock (gate) current = opened.Values.ToArray();
            foreach (var context in current.Reverse())
            {
                try { await context.Failed.DisposeAsync(); } catch (Exception error) { errors.Add(error); }
                try { await context.Context.Connection.DisposeAsync(); } catch (Exception error) { errors.Add(error); } finally { context.Lifetime.Dispose(); }
            }
            try { stateLock.Dispose(); } catch (Exception error) { errors.Add(error); }
            lifetime.Dispose();
            if (errors.Count != 0) throw new AggregateException("Pi history cleanup did not complete", errors); completion.TrySetResult();
        }
        catch (Exception error) { completion.TrySetException(error); }
    }
}
