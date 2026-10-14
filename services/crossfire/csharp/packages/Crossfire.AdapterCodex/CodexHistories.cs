using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterRuntime;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public sealed class CodexHistories : OwnedRuntimeConnection, TurnControl
{
    private sealed record OpenedContext(CodexConnection Connection, CancellationTokenSource Lifetime, CancellationTokenRegistration Failed);
    private readonly OwnedProcess process;
    private readonly OwnedRuntimeInput input;
    private readonly CodexOptions options;
    private readonly string home;
    private readonly string primary;
    private readonly CancellationTokenSource lifetime;
    private readonly CancellationToken token;
    private readonly object gate = new();
    private readonly Dictionary<string, OpenedContext> opened = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Task<Result<CodexConnection>>> initializing = new(StringComparer.Ordinal);
    private ContextRegistryState registry;
    private CodexConnection? selected;
    private Task? closing;
    public string SessionId => Primary.SessionId;
    public RuntimeApproval Approval => Primary.Approval;
    public CancellationToken Lifetime => token;
    public TurnControl TurnControl => this;
    public RuntimeLifecycle? Lifecycle => null;
    private CodexConnection Primary => selected ?? throw new InvalidOperationException("Native primary history is not initialized");
    private CodexHistories(OwnedProcess process, OwnedRuntimeInput input, CodexOptions options, string home, ContextRegistryState registry, CancellationToken cancellation)
    {
        this.process = process; this.input = input; this.options = options; this.home = home; this.registry = registry;
        primary = input.HistoryMode == NativeHistoryMode.Shared ? "shared" : "control";
        lifetime = CancellationTokenSource.CreateLinkedTokenSource(process.Lifetime, cancellation);
        token = lifetime.Token;
    }
    public static async ValueTask<Result<OwnedRuntimeConnection>> Start(OwnedProcess process, OwnedRuntimeInput input, CodexOptions options, string home, CancellationToken cancellation)
    {
        var loaded = ContextRegistry.Read(home); if (!loaded.IsSuccess) return Result<OwnedRuntimeConnection>.Fail(loaded.Error);
        var owner = new CodexHistories(process, input, options, home, loaded.Value, cancellation);
        try
        {
            var primary = loaded.Value.Bindings.FirstOrDefault(binding => binding.Context == owner.primary);
            var existing = PrivateFiles.Exists(Path.Combine(home, ContextRegistry.FileName));
            var changing = existing && loaded.Value.Mode != ContextRegistry.Mode(input.HistoryMode)
                && loaded.Value.Bindings.Any(binding => binding.Context == (loaded.Value.Mode == "shared" ? "shared" : "control"));
            if (primary is null && !changing && (!input.AllowNewHistory || existing))
                return Results.Fail<OwnedRuntimeConnection>("missing", "Saved native history is missing. Resume cannot create a new history; use the explicit fresh-history operation if intended.");
            if (loaded.Value.Mode != ContextRegistry.Mode(input.HistoryMode))
            {
                if (input.Hooks.PendingDecisions?.Invoke() == true) return Results.Fail<OwnedRuntimeConnection>("conflict", "Resolve original native decisions before changing history mode");
                foreach (var context in owner.Contexts()) { var pending = owner.Unacknowledged(context); if (!pending.IsSuccess) return Result<OwnedRuntimeConnection>.Fail(pending.Error);
                    if (pending.Value) return Results.Fail<OwnedRuntimeConnection>("conflict", "Resolve and acknowledge native publication before changing history mode"); }
            }
            var opened = await owner.Open(owner.primary); if (!opened.IsSuccess) return Result<OwnedRuntimeConnection>.Fail(opened.Error);
            if (owner.Lifetime.IsCancellationRequested) return Results.Fail<OwnedRuntimeConnection>("unavailable", "Native history owner stopped before startup completed");
            owner.selected = opened.Value; return Result<OwnedRuntimeConnection>.Success(owner);
        }
        finally { if (owner.selected is null) await owner.DisposeAsync(); }
    }
    private string[] Contexts() { lock (gate) return new[] { "shared", "control" }.Concat(registry.Bindings.Select(binding => binding.Context)).Distinct(StringComparer.Ordinal).ToArray(); }
    private string? Retained(string context) { lock (gate) return registry.Bindings.FirstOrDefault(binding => binding.Context == context)?.SessionId; }
    private Result<bool> Unacknowledged(string context)
    {
        var file = ContextRegistry.Receipt(home, context); if (!PrivateFiles.Exists(file)) return Result<bool>.Success(false);
        var id = Retained(context); if (id is null) return Results.Fail<bool>("invalid", "Native publication journal has no retained context identity");
        return NativeJournal<CodexInput>.Read(file, id, CodexInputCodec.Codec).Map(value => value.Pending is not null || value.Confirmed.Count != 0);
    }
    private ValueTask<Result<CodexConnection>> Open(string context, InputAdmission? admission = null)
    {
        if (!ContextRegistry.ValidContext(context)) return ValueTask.FromResult(Results.Fail<CodexConnection>("invalid", "Invalid native conversation context"));
        if (admission?.Cancellation.IsCancellationRequested == true || Lifetime.IsCancellationRequested) return ValueTask.FromResult(Results.Fail<CodexConnection>("unavailable", "Native history admission was cancelled before acceptance"));
        TaskCompletionSource<Result<CodexConnection>> completion;
        lock (gate)
        {
            if (closing is not null) return ValueTask.FromResult(Results.Fail<CodexConnection>("unavailable", "Native history owner is closed"));
            if (opened.TryGetValue(context, out var current)) return ValueTask.FromResult(Result<CodexConnection>.Success(current.Connection));
            if (initializing.TryGetValue(context, out var pending)) return admission is null ? new(pending)
                : ValueTask.FromResult(Results.Fail<CodexConnection>("unavailable", "Exact room history is opening; immediate input has not been accepted"));
            completion = new(TaskCreationOptions.RunContinuationsAsynchronously); initializing.Add(context, completion.Task);
        }
        _ = Initialize(context, admission, completion); return new(completion.Task);
    }
    private async Task Initialize(string context, InputAdmission? admission, TaskCompletionSource<Result<CodexConnection>> completion)
    {
        var contextLifetime = CancellationTokenSource.CreateLinkedTokenSource(Lifetime);
        var cancelled = admission?.Cancellation.Register(() => contextLifetime.Cancel()) ?? default;
        CodexSession? session = null; CodexConnection? connection = null; var retained = false;
        var result = Results.Fail<CodexConnection>("native", "Native history initialization did not complete");
        try
        {
            var previous = Retained(context);
            lock (gate) if (previous is null && context is not ("shared" or "control") && registry.Bindings.Count(binding => binding.Context is not ("shared" or "control")) >= 2000)
            { result = Results.Fail<CodexConnection>("invalid", "Native room history budget is exhausted"); return; }
            var hooks = input.Hooks with { Observe = value => input.Hooks.Observe?.Invoke(value is NativeState state
                ? state with { RoomId = context is "shared" or "control" ? null : context } : value) };
            var selected = await CodexSession.Open(process.Endpoint, process.Token, input.Workspace, options,
                previous is null ? new CreateThread(input.Name + (context == "shared" ? "" : " · " + context)) : new ResumeThread(previous), hooks, value => connection?.Event(value), contextLifetime.Token);
            if (!selected.IsSuccess) { result = Result<CodexConnection>.Fail(selected.Error); return; } session = selected.Value;
            lock (gate)
            {
                if (previous is null && registry.Bindings.Any(binding => binding.SessionId == session.SessionId)) throw new IOException("The native runtime reused another history identity");
                var next = new ContextRegistryState(ContextRegistry.Mode(input.HistoryMode), previous is null ? [.. registry.Bindings, new(context, session.SessionId)] : registry.Bindings);
                var saved = ContextRegistry.Write(home, next); if (!saved.IsSuccess) { result = Result<CodexConnection>.Fail(saved.Error); return; } registry = next;
            }
            var receipt = ContextRegistry.Receipt(home, context); var instructions = await NativeInstructions.Apply(session, home, receipt + ".instructions", input.Instructions, contextLifetime.Token);
            if (!instructions.IsSuccess) { result = Result<CodexConnection>.Fail(instructions.Error); return; }
            var delivery = CodexConnection.Open(session, receipt, 1000, observe: input.Hooks.Observe); if (!delivery.IsSuccess) { result = Result<CodexConnection>.Fail(delivery.Error); return; }
            connection = delivery.Value; var verified = await connection.Verify(contextLifetime.Token); if (!verified.IsSuccess) { result = Result<CodexConnection>.Fail(verified.Error); return; }
            var failed = session.Lifetime.Register(() => lifetime.Cancel());
            lock (gate) { opened.Add(context, new(connection, contextLifetime, failed)); retained = true; }
            result = Result<CodexConnection>.Success(connection);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException or JsonException or ArgumentException or OperationCanceledException)
        { result = Results.Fail<CodexConnection>("native", "Cannot open the exact owned native history: " + error.Message); }
        finally
        {
            try
            {
                await cancelled.DisposeAsync();
                if (!retained) { if (connection is not null) await connection.DisposeAsync(); else if (session is not null) await session.DisposeAsync(); contextLifetime.Dispose(); }
            }
            catch (Exception error) { result = Results.Fail<CodexConnection>("native", "Native history initialization cleanup failed: " + error.Message); }
            finally { lock (gate) initializing.Remove(context); completion.TrySetResult(result); }
        }
    }
    public async ValueTask<Result<bool>> Inspect()
    {
        if (Lifetime.IsCancellationRequested) return Results.Fail<bool>("unavailable", "Native history owner stopped");
        OpenedContext[] initial; lock (gate) { if (initializing.Count != 0 || input.Hooks.PendingDecisions?.Invoke() == true) return Result<bool>.Success(true); initial = opened.Values.ToArray(); }
        if (initial.Length == 0) return Results.Fail<bool>("unavailable", "Native activity cannot be inspected without an owned live native connection");
        foreach (var context in Contexts())
        {
            OpenedContext? current; lock (gate) opened.TryGetValue(context, out current);
            if (current is not null)
            {
                if (current.Connection.Unsettled) return Result<bool>.Success(true); var busy = await current.Connection.Inspect();
                if (!busy.IsSuccess || busy.Value) return busy;
            }
            else
            {
                var unsettled = Unacknowledged(context); if (!unsettled.IsSuccess || unsettled.Value) return unsettled;
                var session = Retained(context); if (session is null) continue;
                var busy = await initial[0].Connection.InspectSession(session); if (!busy.IsSuccess || busy.Value) return busy;
            }
        }
        lock (gate) return Result<bool>.Success(initializing.Count != 0 || opened.Count != initial.Length || input.Hooks.PendingDecisions?.Invoke() == true || opened.Values.Any(value => value.Connection.Unsettled));
    }
    public ValueTask<Result<Unit>> Deliver(string text, string messageId, CancellationToken cancellation = default, InputPriority? priority = null) => Primary.Deliver(text, messageId, cancellation, priority);
    public ValueTask<Result<bool>> Recover(string text, string messageId, CancellationToken cancellation = default) => Primary.Recover(text, messageId, cancellation);
    public async ValueTask<Result<bool>> Settle(CancellationToken cancellation = default)
    {
        if (Lifetime.IsCancellationRequested) return Results.Fail<bool>("unavailable", "Native history owner stopped");
        foreach (var context in Contexts())
        {
            var pending = Unacknowledged(context); if (!pending.IsSuccess) return pending;
            if (pending.Value) { var selected = await Open(context); if (!selected.IsSuccess) return Result<bool>.Fail(selected.Error); }
        }
        OpenedContext[] current; lock (gate) current = opened.Values.ToArray(); var received = false;
        foreach (var context in current) { var settled = await context.Connection.Settle(cancellation); if (!settled.IsSuccess) return settled; received |= settled.Value; }
        return Result<bool>.Success(received);
    }
    public Result<Unit> Acknowledge(IReadOnlyList<string> messageIds)
    { lock (gate) { if (closing is not null) return Results.Fail<Unit>("unavailable", "Native history owner stopped"); foreach (var context in opened.Values) { var saved = context.Connection.Acknowledge(messageIds); if (!saved.IsSuccess) return saved; } } return Results.Done(); }
    public async ValueTask<Result<RuntimeConnection>> Conversation(string room, InputAdmission? admission = null)
    {
        if (!Validation.RoomId(room)) return Results.Fail<RuntimeConnection>("invalid", "Supply an exact Matrix room identity");
        return (await Open(input.HistoryMode == NativeHistoryMode.Shared ? "shared" : room, admission)).Map<RuntimeConnection>(value => value);
    }
    public async ValueTask<Result<string?>> ActiveTurn(string? room = null, InputAdmission? admission = null)
    {
        var context = input.HistoryMode == NativeHistoryMode.Shared ? "shared" : room ?? "control"; CodexConnection? connection;
        if (admission is not null) { var selected = await Open(context, admission); if (!selected.IsSuccess) return Result<string?>.Fail(selected.Error); connection = selected.Value; }
        else { lock (gate) connection = opened.GetValueOrDefault(context)?.Connection; }
        if (connection is null) return Result<string?>.Success(null);
        return (await connection.ActiveTurn(admission: admission)).Map(value => value is null ? null : "[" + ProtocolJson.Quote(context) + "," + ProtocolJson.Quote(value) + "]");
    }
    public async ValueTask<Result<string>> Interrupt(string turnId, bool recovery = false, InputAdmission? admission = null)
    {
        try
        {
            using var document = JsonDocument.Parse(turnId); var tuple = document.RootElement;
            if (tuple.ValueKind != JsonValueKind.Array || tuple.GetArrayLength() != 2 || tuple.EnumerateArray().Any(value => value.ValueKind != JsonValueKind.String))
                return Results.Fail<string>("invalid", "Invalid captured history and turn");
            var context = tuple[0].GetString()!; if (Retained(context) is null) return Results.Fail<string>("invalid", "Captured native history does not exist");
            var selected = await Open(context, admission); return selected.IsSuccess ? await selected.Value.Interrupt(tuple[1].GetString()!, recovery, admission) : Result<string>.Fail(selected.Error);
        }
        catch (JsonException) { return Results.Fail<string>("invalid", "Invalid captured history and turn"); }
    }
    private RuntimeAttachment Attached(string sessionId) => new("codex", sessionId, input.Workspace, new Dictionary<string, string>(StringComparer.Ordinal)
        { ["endpoint"] = process.Endpoint, ["tokenFile"] = process.TokenFile, ["home"] = home, ["binary"] = process.Binary, ["path"] = process.Path });
    public RuntimeAttachment Attachment => Attached(SessionId);
    public ValueTask<Result<IReadOnlyList<ContextAttachment>>> Attachments()
    { lock (gate) return ValueTask.FromResult(Result<IReadOnlyList<ContextAttachment>>.Success(registry.Bindings.Select(binding => new ContextAttachment(binding.Context, Attached(binding.SessionId))).ToArray())); }
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
            Task<Result<CodexConnection>>[] pending; lock (gate) pending = initializing.Values.ToArray();
            try { await Task.WhenAll(pending); } catch (Exception error) { errors.Add(error); }
            OpenedContext[] current; lock (gate) current = opened.Values.ToArray();
            foreach (var context in current.Reverse())
            {
                try { await context.Failed.DisposeAsync(); } catch (Exception error) { errors.Add(error); }
                try { await context.Connection.DisposeAsync(); } catch (Exception error) { errors.Add(error); }
                finally { context.Lifetime.Dispose(); }
            }
            try { await process.DisposeAsync(); } catch (Exception error) { errors.Add(error); }
            if (errors.Count != 0) throw new AggregateException("Native history cleanup did not complete", errors); completion.TrySetResult();
        }
        catch (Exception error) { try { await process.DisposeAsync(); } finally { completion.TrySetException(error); } }
        finally { lifetime.Dispose(); }
    }
}
