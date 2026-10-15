using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed partial class ListenerReceiver
{
    private async ValueTask<T> Work<T>(Func<CancellationToken, ValueTask<Result<T>>> operation)
    {
        CancellationToken preempted; lock (gate) { if (Urgent() is not null) throw new OrdinaryPreempted(); preempted = ordinary.Token; ordinaryUsers++; }
        try
        {
        using var deadline = new CancellationTokenSource(TimeSpan.FromMilliseconds(options.ReconcileMs), options.Clock); using var scope = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, options.Control.Current().Generation, preempted, deadline.Token);
        try { using var lease = Take(await options.Budget.Acquire(ListenerWork.Acquisition, scope.Token)); return await Retry(() => operation(scope.Token), scope.Token); }
        catch (OperationCanceledException) when (preempted.IsCancellationRequested && !lifetime.IsCancellationRequested) { throw new OrdinaryPreempted(); }
        catch (OperationCanceledException) when (deadline.IsCancellationRequested && !lifetime.IsCancellationRequested && !preempted.IsCancellationRequested) { throw new ReceiverFailure(new("unavailable", "Listener acquisition exceeded its reconciliation deadline")); }
        }
        finally { ReleaseOrdinary(); }
    }
    private async ValueTask<bool> Send(Func<CancellationToken, ValueTask<Result<Unit>>> operation, bool priority = false)
    {
        var control = options.Control.Current(); if (!control.Active) return false; CancellationToken preempted; lock (gate) { if (!priority && (Urgent() is not null || queries.Pending)) return false; preempted = ordinary.Token; ordinaryUsers++; }
        try
        {
        using var cancelled = new CancellationTokenSource(); using var scope = CancellationTokenSource.CreateLinkedTokenSource(cancelled.Token, lifetime.Token, control.Generation, priority ? CancellationToken.None : preempted);
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously); var current = new Sending(cancelled, completion.Task); lock (gate) { if (sending is not null) throw new InvalidOperationException("A receiver publication is already active"); if (!priority && queries.Pending) return false; sending = current; }
        var sent = false;
        try
        {
            using var lease = priority ? null : Take(await options.Budget.Acquire(ListenerWork.Publication, scope.Token)); var result = await operation(scope.Token);
            if (!result.IsSuccess) { if (scope.IsCancellationRequested && !lifetime.IsCancellationRequested) return false; throw new ReceiverFailure(result.Error); } sent = true; return true;
        }
        catch (OperationCanceledException) when (!lifetime.IsCancellationRequested && scope.IsCancellationRequested) { return false; }
        finally { lock (gate) if (ReferenceEquals(sending, current)) sending = null; completion.TrySetResult(sent); Change(); }
        }
        finally { ReleaseOrdinary(); }
    }
    private async ValueTask Wait(long previous, int milliseconds = 0)
    {
        lock (gate) acquiring = false; lifetime.Token.ThrowIfCancellationRequested(); if (Interlocked.Read(ref revision) != previous) return;
        var timeout = milliseconds == 0 ? options.ReconcileMs : milliseconds; if (activity.RunId is not null && synchronized && !state.Paused && options.Control.Current().Active) timeout = Math.Min(timeout, scheduled.WaitMilliseconds);
        await changed.Wait(TimeSpan.FromMilliseconds(Math.Max(1, timeout)), options.Clock, lifetime.Token); lifetime.Token.ThrowIfCancellationRequested();
    }
    private async Task PublishLoop()
    {
        while (!lifetime.IsCancellationRequested)
        {
            artifacts.Cleanup(); var previous = Interlocked.Read(ref revision); var generation = options.Control.Current().Generation;
            try
            {
                if ((!options.Control.Current().Active || state.Paused) && chat.Unpublished) { Take(chat.DiscardUnpublished()); completed = null; }
                if (!options.Control.Current().Active) { await PauseActivity(); await Wait(previous); continue; } if (!await Activate() || generation.IsCancellationRequested) continue;
                if (!synchronized) { await Wait(previous); continue; }
                lock (gate) { if (controlling && (completed is null || ordinary.IsCancellationRequested || Urgent() is not null)) previous = -1; }
                if (previous == -1) { await changed.Wait(TimeSpan.FromMilliseconds(options.ReconcileMs), options.Clock, lifetime.Token); continue; }
                if (!controlling && priorityChat.Pending)
                {
                    PublicationOutcome? recovered = null; await Send(async token => { recovered = Take(await priorityChat.Recover(CurrentRooms(), token)); return Results.Done(); }, true);
                    if (recovered is not null) { AcceptedSteering(recovered.Batch.Events); Take(Runtime.Acknowledge(recovered.MessageIds)); Take(priorityChat.Acknowledge()); continue; }
                    if (priorityChat.Recovering) continue; var urgent = Urgent(); if (urgent is null || !priorityChat.Events.Any(value => value.RoomId == urgent.Room && value.EventId == urgent.Event)) { Take(priorityChat.DiscardUnpublished()); continue; }
                }
                var urgentControl = !controlling && !state.Paused ? Urgent() : null; if (urgentControl is not null) { await PublishUrgent(urgentControl); continue; }
                if (queries.Recovering) await Work(queries.Recover); if (queries.Pending) { await Wait(previous, 1000); continue; }
                if (completed is { } value)
                {
                    IReadOnlySet<string> valid; lock (gate) valid = value.Publication.Batch.Cursors.Keys.Where(room => !retiredRooms.Contains(room)).ToHashSet(StringComparer.Ordinal);
                    var acknowledgedBatch = value.Publication.Batch with { Cursors = ReceiveState.Filter(value.Publication.Batch.Cursors, valid), Latest = ReceiveState.Filter(value.Publication.Batch.Latest, valid) };
                    await Work(token => ReceiveState.Acknowledge(Storage, options.Matrix, File, acknowledgedBatch, token)); Take(Runtime.Acknowledge(value.Publication.MessageIds)); Take(chat.Acknowledge()); completed = null;
                    lock (gate)
                    {
                        if (value.Membership == membershipRevision)
                        {
                            state = state with { Controls = state.Controls.Where(control => control.Status is not ("delivered" or "superseded") || !value.Publication.Batch.Events.Any(item => item.RoomId == control.Room && item.EventId == control.Event)).ToArray() }; SaveControl();
                            if (value.Publication.Batch.MoreRooms.Count == 0) { cycle = null; ReceiveSnapshots.SaveWake(Storage, File, null); }
                        }
                    }
                    if (value.Publication.Batch.MoreRooms.Count == 0) await Wait(previous); continue;
                }
                var recoveredWake = false; if (scheduled.Pending) await Send(async token => { recoveredWake = Take(await scheduled.Recover(token)); return Results.Done(); }); if (recoveredWake) continue;
                if (chat.Recovering)
                {
                    PublicationOutcome? recovered = null; await Send(async token => { recovered = Take(await chat.Recover(CurrentRooms(), token)); return Results.Done(); }); if (recovered is not null) { completed = new(recovered, Interlocked.Read(ref membershipRevision)); continue; }
                }
                if (state.Paused) { await Wait(previous); continue; } lock (gate) retiredRooms.Clear();
                if (chat.Pending)
                {
                    PublicationOutcome? publication = null; var accepted = await Send(async token => { publication = Take(await chat.Publish(CurrentRooms(), token)); return Results.Done(); }); if (accepted && publication is not null) completed = new(publication, Interlocked.Read(ref membershipRevision)); continue;
                }
                if (controlled.Pending) { await Send(controlled.Publish); continue; }
                if (updates.Pending && (Runtime.Lifecycle is null || Runtime.Lifecycle.Current().Phase == "running")) { await Send(token => updates.Publish(Runtime, token)); continue; }
                var scheduledHandled = false; if (scheduled.Due) await Send(async token => { scheduledHandled = Take(await scheduled.Publish(token)); return Results.Done(); }); if (scheduledHandled) continue;
                if (maintenance.Pending) { if (await Work(maintenance.Publish)) { lastAccess = long.MinValue; Change(); } }
                lock (gate) if (cycle is not null && (!allowed.Contains(cycle.Room) || !joined.Contains(cycle.Room) || !senders.Contains(cycle.Sender))) { cycle = null; ReceiveSnapshots.SaveWake(Storage, File, null); windowEnd = 0; }
                await PrepareChat(previous);
            }
            catch (OrdinaryPreempted) { }
            catch (OperationCanceledException) when (!lifetime.IsCancellationRequested && (ordinary.IsCancellationRequested || generation.IsCancellationRequested || !options.Control.Current().Active || Urgent() is not null)) { }
            catch (ReceiverFailure error) when (!lifetime.IsCancellationRequested && (generation.IsCancellationRequested || !options.Control.Current().Active || Retryable(error.Failure)))
            { if (options.Control.Current().Active && !generation.IsCancellationRequested) await changed.Wait(TimeSpan.FromMilliseconds(Math.Min(options.PollMs, 5000)), options.Clock, lifetime.Token); }
        }
    }
    private async ValueTask PublishUrgent(SourceControl urgent)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromMilliseconds(options.ReconcileMs), options.Clock); CancellationToken ordinaryToken; lock (gate) { ordinaryToken = ordinary.Token; ordinaryUsers++; }
        try
        {
        using var scope = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, options.Control.Current().Generation, ordinaryToken, deadline.Token); ReceivedEvent? source = null;
        try
        {
            var native = Take(await AgentIO.Request(options.Matrix, new("GET", AgentWire.Room(urgent.Room) + "/event/" + AgentWire.Segment(urgent.Event)), scope.Token)); if (WireJson.Text(native, "event_id") != urgent.Event) throw new InvalidDataException("Urgent event identity changed"); source = Take(ReceivedEvents.View(native, urgent.Room));
            await Access(scope.Token); if (!joined.Contains(urgent.Room) || !allowed.Contains(urgent.Room) || !Take(await SteeringControl.Authorized(options.Matrix, options.Coordination, options.Profile, source, senders, scope.Token)))
            { receipts.Publish(source, "failed", "Source or room authority changed before native input"); lock (gate) { SetControl(urgent, urgent with { Status = "superseded" }); SaveControl(); } return; }
            if (controlling || state.Paused || Urgent() != urgent) return;
            if (!priorityChat.Pending)
            {
                var events = Take(await ReceivePages.Origins(options.Matrix, options.Profile.Account.UserId, [source], scope.Token)); var identities = Take(await CoordinationValues.Senders(options.Coordination, events, scope.Token)); scope.Token.ThrowIfCancellationRequested(); Take(priorityChat.Prepare(new(events, new Dictionary<string, string>(), [], new Dictionary<string, string>()), events, identities));
            }
            PublicationOutcome? result = null; await Send(async token => { result = Take(await priorityChat.Publish(CurrentRooms(), token)); return Results.Done(); }, true); if (result is not null) { Take(Runtime.Acknowledge(result.MessageIds)); Take(priorityChat.Acknowledge()); }
        }
        catch (ReceiverFailure error) { if (source is not null) receipts.Publish(source, "failed", error.Message); throw; }
        catch (OperationCanceledException) when (ordinaryToken.IsCancellationRequested && !lifetime.IsCancellationRequested) { throw new OrdinaryPreempted(); }
        }
        finally { ReleaseOrdinary(); }
    }
    private async ValueTask PrepareChat(long previous)
    {
        var membership = Interlocked.Read(ref membershipRevision); var original = ReceiveState.Load(Storage, File); lock (gate) acquiring = true;
        try
        {
            var batch = await Work(token => ReceiveSnapshots.Pending(Storage, options.Matrix, options.Profile.Settings, File, options.Limit, options.Room, maximum, since, allowed, cycle, artifacts, token)); statistics.Record(batch.Events, false);
            if (membership != Interlocked.Read(ref membershipRevision) || controlling || state.Paused || Urgent() is not null) return;
            if (senders.Count == 0) { windowEnd = 0; await Wait(previous); return; }
            var pending = batch.Events.Where(Accept).ToArray();
            if (cycle is null)
            {
                var trigger = await Work(token => ReceiveSnapshots.Wake(options.Matrix, batch, senders, allowed, options.Room, Accept, token));
                if (trigger is not null)
                {
                    if (windowEnd == 0) windowEnd = Now + options.DebounceMs; if (Now < windowEnd) { await Wait(previous, checked((int)(windowEnd - Now))); return; }
                    var rooms = batch.Cursors.Keys.Where(room => allowed.Contains(room) && (options.Room is null || room == options.Room) && (options.HistoryMode != NativeHistoryMode.PerRoom || room == trigger.RoomId)).ToHashSet(StringComparer.Ordinal);
                    cycle = await Work(token => ReceiveSnapshots.Capture(options.Matrix, trigger, rooms, since ?? throw new InvalidOperationException("Wake capture requires a synchronized boundary"), token)); ReceiveSnapshots.SaveWake(Storage, File, cycle); windowEnd = 0;
                }
                else if (pending.Length != 0) { windowEnd = 0; await Wait(previous); return; }
            }
            if (cycle is { } current)
            {
                var eligible = options.HistoryMode == NativeHistoryMode.PerRoom ? current.Ends.Keys.Where(allowed.Contains).ToHashSet(StringComparer.Ordinal) : allowed;
                if (options.HistoryMode == NativeHistoryMode.PerRoom) batch = batch with { Events = batch.Events.Where(value => eligible.Contains(value.RoomId)).ToArray(), Cursors = ReceiveSnapshots.Merge(ReceiveState.Load(Storage, File), ReceiveState.Filter(batch.Cursors, eligible)), Latest = ReceiveState.Filter(batch.Latest, eligible), MoreRooms = batch.MoreRooms.Where(eligible.Contains).ToArray() };
                batch = await Work(token => ReceiveSnapshots.Collect(Storage, options.Matrix, options.Profile.Settings, File, options.Limit, maximum, batch, current, eligible, artifacts, token));
            }
            if (membership != Interlocked.Read(ref membershipRevision) || controlling || state.Paused || Urgent() is not null) return;
            var emitted = await Work(token => ReceivePages.Origins(options.Matrix, options.Profile.Account.UserId, batch.Events.Where(Accept).ToArray(), token)); var identities = await Work(token => CoordinationValues.Senders(options.Coordination, emitted, token));
            lock (gate)
            {
                if (membership != membershipRevision || controlling || state.Paused || Urgent() is not null || queries.Pending || !ReceiveState.Same(original, ReceiveState.Load(Storage, File))) return; Take(chat.Prepare(batch, emitted, identities));
            }
        }
        finally { lock (gate) acquiring = false; }
    }
}
