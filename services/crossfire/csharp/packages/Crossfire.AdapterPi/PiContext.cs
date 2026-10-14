using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AgentCore;
using Crossfire.Kernel;

namespace Crossfire.AdapterPi;

public sealed class PiContext : IAsyncDisposable
{
    private readonly string history;
    private readonly RuntimeHooks hooks;
    private readonly PiObservation observation;
    private readonly PiUsage usage;
    private readonly HashSet<Task> questions = [];
    private readonly object gate = new();
    private readonly CancellationTokenSource lifetime;
    private CancellationTokenSource run = new();
    private PiProtocol? native;
    private PiConnection? connection;
    private string session;
    private string? fault;
    private bool interrupted;
    private Task? closing;
    public PiConnection Connection => connection ?? throw new InvalidOperationException("Pi context is not ready");
    public PiBinding Binding { get; private set; }
    public CancellationToken Lifetime { get; }
    private PiContext(OwnedRuntimeInput input, string home, PiBinding binding, CancellationToken cancellation)
    {
        history = PiState.History(home, binding); Binding = binding; session = binding.SessionId ?? "";
        lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellation); Lifetime = lifetime.Token;
        hooks = input.Hooks with { Observe = value => input.Hooks.Observe?.Invoke(value is NativeState state
            ? state with { RoomId = binding.Context is "shared" or "control" ? null : binding.Context } : value) };
        observation = new(hooks, () => session, () => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()); usage = new(hooks, () => session);
    }
    public static async ValueTask<Result<PiContext>> Open(string binary, string home, PiBinding binding, OwnedRuntimeInput input, PiOptions options, CancellationToken cancellation)
    {
        var owner = new PiContext(input, home, binding, cancellation); var ready = false;
        try
        {
            var started = await PiProtocol.Start(binary, home, input.Workspace, input.StateDirectory, input.Profile, owner.history, input.Instructions, owner.Event, owner.Lifetime);
            if (!started.IsSuccess) return Result<PiContext>.Fail(started.Error); owner.native = started.Value;
            var admitted = await PiAdmission.Read(owner.native, options, owner.Lifetime); if (!admitted.IsSuccess) return Result<PiContext>.Fail(admitted.Error);
            var state = admitted.Value.State; var id = PiValues.Text(state, "sessionId");
            if (id is null || !Contracts.Validation.Identifier(id) || binding.SessionId is not null && binding.SessionId != id || PiValues.Text(state, "sessionFile") != owner.history)
                return Results.Fail<PiContext>("conflict", "Pi substituted its native session identity or path");
            owner.session = id; var verified = PiState.Verify(home, owner.history, input.Workspace, id); if (!verified.IsSuccess) return Result<PiContext>.Fail(verified.Error);
            NativeHistory.MakePrivateAndFlush(home, owner.history); var digest = Identity.Hash(input.Instructions);
            if (binding.InstructionsDigest != digest)
            {
                var boundary = NativeHistory.Capture(home, owner.history);
                var applied = PiValues.ObjectReply(await owner.native.Control("instructions", PiValues.Object(writer => { writer.WriteString("text", input.Instructions); writer.WriteString("digest", digest); }), owner.Lifetime));
                if (!applied.IsSuccess) return Result<PiContext>.Fail(applied.Error);
                var entry = PiValues.Text(applied.Value, "entryId"); if (entry is null) return Results.Fail<PiContext>("native", "Pi did not return its native instruction entry");
                verified = PiState.Instructions(home, owner.history, boundary, entry, digest, input.Instructions); if (!verified.IsSuccess) return Result<PiContext>.Fail(verified.Error);
            }
            owner.Binding = binding with { SessionId = id, InstructionsDigest = digest }; owner.observation.Configure(admitted.Value.Settings);
            var stats = await owner.native.Request("get_session_stats", PiValues.Empty(), owner.Lifetime); if (!stats.IsSuccess) return Result<PiContext>.Fail(stats.Error); owner.usage.Initialize(stats.Value);
            var delivery = PiConnection.Open(owner.native, home, owner.history, input.Workspace, PiHistories.Receipt(home, binding.Context), id, owner.hooks, owner.CloseNative);
            if (!delivery.IsSuccess) return Result<PiContext>.Fail(delivery.Error); owner.connection = delivery.Value;
            verified = await owner.connection.Verify(owner.Lifetime); if (!verified.IsSuccess) return Result<PiContext>.Fail(verified.Error);
            cancellation.ThrowIfCancellationRequested(); owner.observation.State("idle"); ready = true; return Result<PiContext>.Success(owner);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException or ArgumentException or OperationCanceledException)
        { return Results.Fail<PiContext>("native", "Cannot open the exact Pi native context: " + PiValues.ErrorText(error.Message)); }
        finally { if (!ready) await owner.DisposeAsync(); }
    }
    private void Event(JsonElement value)
    {
        connection?.Changed(); usage.Event(value); var type = PiValues.Text(value, "type");
        if (type == "extension_error") throw new InvalidDataException(PiValues.ErrorText("Native Pi extension failed: " + (PiValues.Text(value, "error") ?? "Unknown extension error")));
        if (type == "agent_start") { run.Cancel(); run.Dispose(); run = new(); fault = null; interrupted = false; }
        else if (type == "interruption_started") { interrupted = true; run.Cancel(); }
        else if (type == "message_end")
        {
            var message = value.GetProperty("message");
            if (PiValues.Text(message, "role") == "assistant") fault = PiValues.Text(message, "stopReason") == "error" ? PiValues.ErrorText(PiValues.Text(message, "errorMessage") ?? "Pi execution failed") : null;
        }
        else if (type == "agent_settled")
        {
            run.Cancel();
            if (fault is not null && !interrupted) { observation.State("failed", fault); native?.Fail(new("native", fault)); return; }
        }
        if (PiQuestions.IsQuestion(value))
        {
            if (native is null || connection is null) throw new InvalidDataException("Pi requested human input before native readiness");
            observation.State("waiting-answer"); var current = run.Token; var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            lock (gate) questions.Add(completion.Task); _ = Question(value, current, completion);
        }
        else if (session.Length != 0) observation.Event(value);
    }
    private async Task Question(JsonElement value, CancellationToken current, TaskCompletionSource completion)
    {
        using var scope = CancellationTokenSource.CreateLinkedTokenSource(Lifetime, native!.Lifetime, current);
        try
        {
            var captured = await Connection.ActiveTurn(); if (!captured.IsSuccess) { native.Fail(captured.Error); return; }
            if (captured.Value is null) throw new InvalidDataException("Pi question has no original active execution");
            var decoded = PiQuestions.Decode(value, session, captured.Value); if (!decoded.IsSuccess) { native.Fail(decoded.Error); return; } var decision = decoded.Value;
            using var timeout = decision.ExpiresMs is null ? null : new CancellationTokenSource(TimeSpan.FromMilliseconds(decision.ExpiresMs.Value));
            using var expires = timeout is null ? null : CancellationTokenSource.CreateLinkedTokenSource(scope.Token, timeout.Token);
            try { var result = await PiQuestions.Answer(native, hooks, decision, expires?.Token ?? scope.Token); if (!result.IsSuccess) { native.Fail(result.Error); return; } }
            catch (OperationCanceledException) when (!scope.IsCancellationRequested && timeout?.IsCancellationRequested == true)
            { var cancelled = await PiQuestions.Cancel(native, decision.Request); if (!cancelled.IsSuccess) native.Fail(cancelled.Error); }
            if (!scope.IsCancellationRequested) observation.State("working");
        }
        catch (Exception error) when (error is not (OutOfMemoryException or StackOverflowException or AccessViolationException))
        { if (!scope.IsCancellationRequested) native.Fail(new("native", "Pi owner question failed: " + PiValues.ErrorText(error.Message))); }
        finally { lock (gate) questions.Remove(completion.Task); completion.TrySetResult(); }
    }
    public ValueTask DisposeAsync() => connection?.DisposeAsync() ?? CloseNative();
    private ValueTask CloseNative()
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
            if (native is not null) { try { await native.DisposeAsync(); } catch (Exception error) { errors.Add(error); } }
            try { run.Cancel(); } catch (Exception error) { errors.Add(error); }
            Task[] pending; lock (gate) pending = questions.ToArray(); try { await Task.WhenAll(pending); } catch (Exception error) { errors.Add(error); }
            observation.Dispose(); run.Dispose(); lifetime.Dispose();
            if (errors.Count != 0) throw new AggregateException("Pi context cleanup did not complete", errors); completion.TrySetResult();
        }
        catch (Exception error) { observation.Dispose(); completion.TrySetException(error); }
    }
}
