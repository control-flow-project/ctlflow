using Crossfire.AgentCore;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Fleetd.Domain;

public sealed partial class NativeLifecycle : RuntimeLifecycle, IAsyncDisposable
{
    private readonly NativeLifecycleServices services;
    private readonly object gate = new(), observationGate = new();
    private readonly SemaphoreSlim transition = new(1, 1);
    private readonly CancellationTokenSource lifetime;
    private IReadOnlyList<SavedRuntimeContext> contexts;
    private readonly Dictionary<string, NativeState> observations = new(StringComparer.Ordinal);
    private readonly HashSet<string> working = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> unsettled = new(StringComparer.Ordinal);
    private OwnedRuntimeConnection? native;
    private CancellationTokenRegistration nativeClosed;
    private ITimer? idleTimer;
    private Task? recovery, idleWork, closing;
    private string session, phase = "sleeping";
    private long lastActivity, generation, workRevision;
    private int idleSeconds = 1800, activeCalls, inspections, closed;
    private bool activated, ready, recording, failedEpisode, inspectionUncertain;
    private Failure? initializationFailure;
    public RuntimeConnection Runtime { get; private set; } = null!;
    private long Now => services.Clock.GetUtcNow().ToUnixTimeMilliseconds();
    private NativeLifecycle(NativeLifecycleServices services, IReadOnlyList<SavedRuntimeContext> contexts, CancellationToken stop)
    { this.services = services; this.contexts = contexts; lifetime = CancellationTokenSource.CreateLinkedTokenSource(stop); session = contexts.FirstOrDefault(value => value.Context == services.Primary)?.SessionId ?? ""; lastActivity = Now; }
    public static async ValueTask<Result<NativeLifecycle>> Start(NativeLifecycleServices services, CancellationToken stop)
    {
        var saved = services.Saved(); if (!saved.IsSuccess) return Result<NativeLifecycle>.Fail(saved.Error); var interrupted = services.Work.Read(); if (!interrupted.IsSuccess) return Result<NativeLifecycle>.Fail(interrupted.Error);
        var owner = new NativeLifecycle(services, saved.Value, stop); if (services.Initial == "sleeping" && owner.session.Length == 0) { owner.lifetime.Dispose(); owner.transition.Dispose(); return Results.Fail<NativeLifecycle>("missing", "Exact native history is missing; automatic recovery never creates a new history"); }
        if (services.Initial == "running" || services.Hooks.PendingDecisions?.Invoke() == true)
        { var opened = await owner.Ensure(); if (!opened.IsSuccess) { await owner.DisposeAsync(); return Result<NativeLifecycle>.Fail(opened.Error); } }
        else owner.Emit("sleeping");
        owner.Runtime = new Logical(owner, services.Primary, owner.session); return Result<NativeLifecycle>.Success(owner);
    }
    public NativeSessionState Current() { lock (gate) return new(phase, lastActivity, session.Length != 0); }
    public Result<Unit> ConfigureIdle(int seconds)
    { if (seconds is < 0 or > 604800) return Results.Fail<Unit>("invalid", "Invalid native idle timeout"); lock (gate) { idleSeconds = seconds; Schedule(); } return Results.Done(); }
    private void Schedule()
    {
        idleTimer?.Dispose(); idleTimer = null; if (idleSeconds == 0 || phase != "running" || lifetime.IsCancellationRequested) return;
        idleTimer = services.Clock.CreateTimer(_ => BeginIdle(), null, TimeSpan.FromMilliseconds(Math.Max(1, lastActivity + idleSeconds * 1000L - Now)), Timeout.InfiniteTimeSpan);
    }
    private void BeginIdle()
    {
        TaskCompletionSource completion; lock (gate) { idleTimer?.Dispose(); idleTimer = null; if (idleWork is not null && !idleWork.IsCompleted || lifetime.IsCancellationRequested) return; completion = new(TaskCreationOptions.RunContinuationsAsynchronously); idleWork = completion.Task; }
        _ = Finish(); async Task Finish() { try { await SleepIfIdle(); completion.TrySetResult(); } catch (Exception error) { completion.TrySetException(error); Report(new("unavailable", "Native idle transition requires inspection: " + error.Message)); } }
    }
    private void Touch() { lock (gate) { lastActivity = Now; Schedule(); } }
    private void Emit(string state, string? message = null)
    {
        NativeState[] events; lock (gate) events = contexts.Select(context => new NativeState(services.Runtime, context.SessionId, context.Context is "shared" or "control" ? null : context.Context, state, Now, observations.GetValueOrDefault(context.SessionId)?.Settings ?? services.Settings, message is null ? null : TextRules.TruncateUtf8(message, 4000))).ToArray();
        foreach (var value in events) { lock (gate) observations[value.SessionId] = value; services.Hooks.Observe?.Invoke(value); }
    }
    private void Report(Failure error)
    {
        bool report; lock (gate) { if (lifetime.IsCancellationRequested) return; phase = "failed"; report = !failedEpisode; failedEpisode = true; initializationFailure = error; }
        if (report) services.Failed(session.Length == 0 ? null : session, error);
    }
    private Result<Unit> CaptureInput(string context, string sessionId)
    {
        lock (observationGate) { workRevision++; return services.Work.Capture([new(context, sessionId)]); }
    }
    private async ValueTask<Result<bool>> InspectNative(OwnedRuntimeConnection connection)
    {
        Interlocked.Increment(ref inspections);
        try { return await InspectCurrent(connection); }
        finally { Interlocked.Decrement(ref inspections); }
    }
    private async ValueTask<Result<bool>> InspectCurrent(OwnedRuntimeConnection connection)
    {
        long revision; lock (observationGate) revision = workRevision;
        var activity = await connection.Activity(); if (!activity.IsSuccess) return Result<bool>.Fail(activity.Error);
        var status = Result<bool>.Success(activity.Value.Busy);
        lock (observationGate)
        {
            InterruptedContext[] completed;
            lock (gate)
            {
                if (!ready || !ReferenceEquals(native, connection) || connection.Lifetime.IsCancellationRequested || revision != workRevision) return status;
                var saved = contexts.ToDictionary(value => value.Context, value => value.SessionId, StringComparer.Ordinal);
                var pending = unsettled.Values.ToHashSet(StringComparer.Ordinal);
                completed = activity.Value.Contexts.Where(value => !value.Busy && !pending.Contains(value.Context) && saved.GetValueOrDefault(value.Context) == value.SessionId)
                    .Select(value => new InterruptedContext(value.Context, value.SessionId)).ToArray();
            }
            var cleared = services.Work.Clear(completed); if (!cleared.IsSuccess) return Result<bool>.Fail(cleared.Error);
        }
        return status;
    }
    private void Observe(RuntimeObservationEvent value, long epoch)
    {
        Failure? failure = null; var forward = true;
        lock (observationGate)
        {
            bool capture; bool active = false; NativeState? previous = null;
            lock (gate)
            {
                if (epoch != generation || lifetime.IsCancellationRequested) return; capture = recording;
                if (value is NativeOutput) Touch();
                else if (value is NativeState state)
                {
                    previous = observations.GetValueOrDefault(state.SessionId); observations[state.SessionId] = state;
                    if (state.State is "working" or "waiting-answer" or "waiting-approval") working.Add(state.SessionId); else if (state.State is "idle" or "sleeping") working.Remove(state.SessionId); active = working.Contains(state.SessionId);
                    if (active || state.State == "idle" && previous?.State is "working" or "waiting-answer" or "waiting-approval") Touch(); forward = ready || state.State is "failed" or "unavailable" or "sleeping" or "waking";
                }
            }
            if (capture && value is NativeState observed)
            {
                Result<Unit> stored = Results.Done(); if (active) { workRevision++; stored = services.Work.Capture([new(observed.RoomId ?? services.Primary, observed.SessionId)]); }
                if (!stored.IsSuccess) failure = stored.Error;
            }
        }
        if (failure is not null) { Report(failure); lifetime.Cancel(); return; } if (forward) services.Hooks.Observe?.Invoke(value);
    }
    private Result<Unit> RefreshContexts()
    {
        var saved = services.Saved(); if (!saved.IsSuccess) return Result<Unit>.Fail(saved.Error);
        var primary = saved.Value.FirstOrDefault(value => value.Context == services.Primary); if (primary is null || primary.SessionId != session) return Results.Fail<Unit>("conflict", "Saved native history changed while its listener binding was active"); lock (gate) contexts = saved.Value; return Results.Done();
    }
    private async ValueTask<Result<OwnedRuntimeConnection>> Ensure(InputAdmission? admission = null, bool prepare = true)
    {
        if (lifetime.IsCancellationRequested) return Results.Fail<OwnedRuntimeConnection>("unavailable", "Native listener binding is stopped"); admission?.Cancellation.ThrowIfCancellationRequested();
        if (admission is not null) { if (!transition.Wait(0)) return Results.Fail<OwnedRuntimeConnection>("unavailable", "Exact-history resume or shutdown is already in progress; immediate input has not been accepted"); }
        else await transition.WaitAsync(lifetime.Token);
        try
        {
            var connection = native;
            if (connection is null || connection.Lifetime.IsCancellationRequested)
            {
                if (connection is not null) { var discarded = await Discard(connection); if (!discarded.IsSuccess) return Result<OwnedRuntimeConnection>.Fail(discarded.Error); }
                long epoch; lock (gate) { epoch = ++generation; ready = false; recording = false; phase = "waking"; } Emit("waking");
                var started = await services.Start(value => Observe(value, epoch), admission, lifetime.Token); if (!started.IsSuccess) { Report(started.Error); Emit("failed", started.Error.Message); return Result<OwnedRuntimeConnection>.Fail(started.Error); }
                connection = started.Value; if (lifetime.IsCancellationRequested || admission?.Cancellation.IsCancellationRequested == true) { await connection.DisposeAsync(); return Results.Fail<OwnedRuntimeConnection>("unavailable", "Native startup was cancelled before admission"); }
                if (session.Length != 0 && session != connection.SessionId) { await connection.DisposeAsync(); var error = new Failure("conflict", "Resume returned a different native history; fresh history was not authorized"); Report(error); return Result<OwnedRuntimeConnection>.Fail(error); }
                lock (gate) { session = connection.SessionId; native = connection; } var saved = RefreshContexts(); if (!saved.IsSuccess) { await Discard(connection); Report(saved.Error); return Result<OwnedRuntimeConnection>.Fail(saved.Error); }
                var selected = connection; nativeClosed = connection.Lifetime.Register(() => NativeEnded(selected));
            }
            if (connection.Lifetime.IsCancellationRequested) return Results.Fail<OwnedRuntimeConnection>("unavailable", "Native session ended during resume");
            if (activated && prepare && !ready)
            {
                lock (gate) recording = false; var settled = await connection.Settle(lifetime.Token); if (!settled.IsSuccess) return await InitializationFailed(connection, settled.Error);
                var resumed = await ResumeTasks.Resume(connection, services.Primary, contexts, services.Work); if (!resumed.IsSuccess) return await InitializationFailed(connection, resumed.Error);
                InterruptedContext[] active; lock (gate) active = contexts.Where(context => working.Contains(context.SessionId)).Select(context => new InterruptedContext(context.Context, context.SessionId)).ToArray(); var captured = services.Work.Capture(active); if (!captured.IsSuccess) return await InitializationFailed(connection, captured.Error);
                if (connection.Lifetime.IsCancellationRequested || lifetime.IsCancellationRequested) return Results.Fail<OwnedRuntimeConnection>("unavailable", "Native generation changed during initialization");
                lock (gate) { ready = true; recording = true; phase = "running"; initializationFailure = null; failedEpisode = false; Touch(); } services.Recovered();
                NativeState[] values; lock (gate) values = observations.Values.ToArray(); foreach (var value in values) services.Hooks.Observe?.Invoke(value with { ObservedAt = Now });
            }
            return Result<OwnedRuntimeConnection>.Success(connection);
        }
        catch (Exception error) when (error is IOException or InvalidDataException or InvalidOperationException or OperationCanceledException)
        { var failure = new Failure("unavailable", "Exact-history activation did not complete: " + error.Message); Report(failure); return Result<OwnedRuntimeConnection>.Fail(failure); }
        finally { transition.Release(); }
    }
    private async ValueTask<Result<OwnedRuntimeConnection>> InitializationFailed(OwnedRuntimeConnection connection, Failure error)
    { var discarded = await Discard(connection); var failure = discarded.IsSuccess ? error : discarded.Error; Report(failure); Emit("failed", failure.Message); return Result<OwnedRuntimeConnection>.Fail(failure); }
    private async ValueTask<Result<Unit>> Discard(OwnedRuntimeConnection connection)
    {
        lock (gate) { if (ReferenceEquals(native, connection)) { native = null; ready = false; recording = false; generation++; } } nativeClosed.Unregister();
        try { await connection.DisposeAsync(); return Results.Done(); } catch (Exception error) when (error is IOException or InvalidOperationException or OperationCanceledException or AggregateException) { return Results.Fail<Unit>("conflict", "Native process cleanup failed; replacement is blocked until cleanup is verified: " + error.Message); }
    }
    private void NativeEnded(OwnedRuntimeConnection connection)
    {
        TaskCompletionSource completion; lock (gate) { if (!ReferenceEquals(native, connection) || lifetime.IsCancellationRequested || recovery is not null) return; completion = new(TaskCreationOptions.RunContinuationsAsynchronously); recovery = completion.Task; }
        var error = new Failure("unavailable", "Owned native execution disconnected; recovering its exact saved history"); Report(error); Emit("failed", error.Message);
        _ = Finish(); async Task Finish() { try { await Recover(connection); completion.TrySetResult(); } catch (Exception failure) { completion.TrySetException(failure); Report(new("unavailable", "Native recovery requires inspection: " + failure.Message)); } finally { lock (gate) if (ReferenceEquals(recovery, completion.Task)) recovery = null; } }
    }
    private async Task Recover(OwnedRuntimeConnection connection)
    {
        try
        {
            await transition.WaitAsync(lifetime.Token); try { var discarded = await Discard(connection); if (!discarded.IsSuccess) { Report(discarded.Error); return; } } finally { transition.Release(); }
            for (var attempt = 0; !lifetime.IsCancellationRequested; attempt++)
            {
                var restored = await Ensure(); if (restored.IsSuccess) return; if (!Recoverable(restored.Error)) return;
                await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(60000, 1000 * (1 << Math.Min(attempt, 6)))), services.Clock, lifetime.Token);
            }
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
    }
    private static bool Recoverable(Failure value) => value.Code is "native" or "unavailable" or "body_too_large";
    public async ValueTask<Result<Unit>> Activate()
    {
        lock (gate) activated = true; var work = services.Work.Read(); if (!work.IsSuccess) return Result<Unit>.Fail(work.Error); if (native is not null || work.Value.Count != 0) return (await Ensure()).Map(_ => default(Unit)); lock (gate) recording = true; return Results.Done();
    }
    public async ValueTask<Result<Unit>> Resume() { Touch(); return (await Ensure()).Map(_ => default(Unit)); }
    public Result<IReadOnlyList<SavedRuntimeContext>> Contexts() => services.Saved();
    public async ValueTask<Result<RuntimeAttachment>> Attachment(string? context = null)
    {
        var connection = native; if (connection is null || connection.Lifetime.IsCancellationRequested || Current().Phase != "running") return Results.Fail<RuntimeAttachment>("conflict", "Native session is sleeping or unavailable; resume it explicitly before attaching a terminal");
        if (context is null || context == services.Primary) return connection.Attachment is { } attachment ? Result<RuntimeAttachment>.Success(attachment) : Results.Fail<RuntimeAttachment>("unavailable", "This native runtime does not support attaching a terminal to its existing process");
        var attachments = await connection.Attachments(); if (!attachments.IsSuccess) return Result<RuntimeAttachment>.Fail(attachments.Error); var selected = attachments.Value.FirstOrDefault(value => value.Context == context); return selected is null ? Results.Fail<RuntimeAttachment>("missing", "No live native attachment exists for the exact context") : Result<RuntimeAttachment>.Success(selected.Attachment);
    }
    private async Task SleepIfIdle()
    {
        if (!await transition.WaitAsync(0)) return;
        try
        {
            var connection = native; var pending = services.Hooks.PendingDecisions?.Invoke() == true || services.Hooks.PendingInput?.Invoke() == true; lock (gate)
            {
                if (!activated || lifetime.IsCancellationRequested || idleSeconds == 0 || phase != "running" || connection is null) return;
                if (Now < lastActivity + idleSeconds * 1000L) { Schedule(); return; }
                if (activeCalls != 0 || unsettled.Count != 0 || pending) { Touch(); return; }
            }
            var status = await InspectNative(connection); var refreshed = RefreshContexts(); if (!status.IsSuccess || !refreshed.IsSuccess)
            {
                var error = status.IsSuccess ? refreshed.Error : status.Error; if (!inspectionUncertain) { inspectionUncertain = true; services.Failed(session, error); Emit("unavailable", error.Message); } Touch(); return;
            }
            if (inspectionUncertain) { inspectionUncertain = false; services.Recovered(); }
            pending = services.Hooks.PendingDecisions?.Invoke() == true || services.Hooks.PendingInput?.Invoke() == true; lock (gate) if (status.Value || activeCalls != 0 || unsettled.Count != 0 || pending || Now < lastActivity + idleSeconds * 1000L) { Touch(); return; }
            var discarded = await Discard(connection); if (!discarded.IsSuccess) { Report(discarded.Error); return; } lock (gate) phase = "sleeping"; Emit("sleeping");
        }
        catch (Exception error) when (error is IOException or InvalidOperationException or InvalidDataException) { Report(new("unavailable", "Native idle inspection failed: " + error.Message)); }
        finally { transition.Release(); }
    }
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task pending;
        lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } pending = closing; }
        if (completion is not null) _ = Finish(completion); return new(pending);
        async Task Finish(TaskCompletionSource result) { try { await Close(); result.TrySetResult(); } catch (Exception error) { result.TrySetException(error); } }
    }
    private async Task Close()
    {
        if (Interlocked.Exchange(ref closed, 1) != 0) return;
        bool inspect; lock (gate) inspect = ready && inspections == 0;
        if (inspect && native is { } current && !current.Lifetime.IsCancellationRequested) await InspectNative(current);
        lock (gate) { recording = false; idleTimer?.Dispose(); idleTimer = null; }
        List<Exception> errors = []; async Task Finish(Func<Task> action) { try { await action(); } catch (Exception error) { errors.Add(error); } }
        await Finish(lifetime.CancelAsync);
        await transition.WaitAsync(); try { if (native is { } connection) await Finish(async () => { var discarded = await Discard(connection); if (!discarded.IsSuccess) throw new InvalidOperationException(discarded.Error.Message); }); } finally { transition.Release(); }
        var recovering = recovery; if (recovering is not null) await Finish(() => recovering); var idle = idleWork; if (idle is not null) await Finish(() => idle); transition.Dispose(); lifetime.Dispose(); if (errors.Count != 0) throw new AggregateException("Native lifecycle shutdown requires inspection", errors);
    }
}
