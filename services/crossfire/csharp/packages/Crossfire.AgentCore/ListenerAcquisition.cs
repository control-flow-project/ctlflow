using System.Text.Json;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed partial class ListenerReceiver
{
    private async ValueTask Access(CancellationToken cancellation)
    {
        await accessGate.WaitAsync(cancellation); try
        {
            var policy = Take(await OwnerAuthority.Policy(options.Coordination, options.Profile, cancellation)); Volatile.Write(ref maximum, policy.MaxMessageBytes); if (Runtime.Lifecycle is { } lifecycle) Take(lifecycle.ConfigureIdle(policy.IdleTimeoutSeconds));
            var next = policy.Rooms.Where(room => !room.Muted).Select(room => room.RoomId).ToHashSet(StringComparer.Ordinal); bool different; IReadOnlySet<string> old;
            lock (gate) { old = allowed; different = !next.SetEquals(allowed) || !policy.Senders.SetEquals(senders); }
            if (different) { await CancelDelivery(); lock (gate) { ReceiveSnapshots.Retire(Storage, File, old.Where(room => !next.Contains(room)).ToHashSet(StringComparer.Ordinal)); allowed = next; senders = policy.Senders; membershipRevision++; } }
            lastAccess = Now;
        }
        finally { accessGate.Release(); }
    }
    private async Task AcquireLoop()
    {
        try
        {
            while (!lifetime.IsCancellationRequested)
            {
                await options.Control.WaitForActivation(lifetime.Token); var generation = options.Control.Current().Generation;
                using var deadline = new CancellationTokenSource(TimeSpan.FromMilliseconds(options.ReconcileMs), options.Clock); using var scope = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, generation, deadline.Token);
                try
                {
                    var sync = await Retry(() => ReceivePages.Sync(options.Matrix, since, Math.Min(options.PollMs, options.ReconcileMs / 2), scope.Token), scope.Token); lock (gate) controlling = true;
                    var membership = Take(await ReceivePages.Joined(options.Matrix, scope.Token)); if (!membership.SetEquals(joined) || lastAccess == long.MinValue || Now - lastAccess >= options.ReconcileMs) await Access(scope.Token);
                    var reset = Take(await SyncEvents.MembershipResets(options.Matrix, sync, options.Profile.Account, since, scope.Token)).Concat(joined.Where(room => !membership.Contains(room))).ToHashSet(StringComparer.Ordinal);
                    if (reset.Count != 0)
                    {
                        await CancelDelivery(); lock (gate)
                        {
                            if (cycle is not null && reset.Contains(cycle.Room)) { cycle = null; ReceiveSnapshots.SaveWake(Storage, File, null); windowEnd = 0; }
                            membershipRevision++; retiredRooms.UnionWith(reset); ReceiveSnapshots.Retire(Storage, File, reset); SyncEvents.RetainJoined(Storage, File, membership.Where(room => !reset.Contains(room)).ToHashSet(StringComparer.Ordinal)); state = state with { Controls = state.Controls.Where(control => !reset.Contains(control.Room)).ToArray() };
                        }
                    }
                    if (since is not null && SyncEvents.Section(sync, "join") is { } rooms)
                    {
                        var filter = WireJson.Object(writer => { writer.WriteStartArray("types"); writer.WriteStringValue("m.room.message"); writer.WriteEndArray(); });
                        foreach (var room in rooms.EnumerateObject())
                        {
                            if (options.Room is not null && room.Name != options.Room || !joined.Contains(room.Name) || !membership.Contains(room.Name) || reset.Contains(room.Name)) continue;
                            await foreach (var native in SyncEvents.Incremental(options.Matrix, sync, since, room.Name, filter, scope.Token))
                            {
                                var value = Take(ReceivedEvents.View(Take(native), room.Name)); if (value.Type != "m.room.message") continue; statistics.Record([value], false);
                                lock (gate) if (state.Controls.Any(control => control.Room == value.RoomId && control.Event == value.EventId)) continue;
                                var candidate = SteeringControl.Mention(value, options.Profile.Account.UserId) || value.Sender == options.Profile.Settings.Owner && WireJson.Text(value.Content, "body")?.Trim() == "!!";
                                if (candidate) await Access(scope.Token); if (!allowed.Contains(value.RoomId)) continue;
                                if (!senders.Contains(value.Sender) && SteeringControl.Mention(value, options.Profile.Account.UserId)) maintenance.Notice(value);
                                if (!Take(await SteeringControl.Authorized(options.Matrix, options.Coordination, options.Profile, value, senders, scope.Token)))
                                { lock (gate) if (state.Paused && SteeringControl.SourceText(value, options.Profile.Settings.Owner)) { state = state with { Paused = false }; SaveControl(); Change(); } continue; }
                                await Interrupt(value, scope.Token);
                            }
                        }
                    }
                    lock (gate)
                    {
                        joined = membership; controlling = false; maintenance.Observe(sync); SaveControl(); since = WireJson.Text(sync, "next_batch") ?? throw new InvalidDataException("Missing native sync continuation"); ReceiveState.CheckpointSync(Storage, File, since); synchronized = true; RenewOrdinary();
                    }
                    Change();
                }
                catch (OperationCanceledException) when (!lifetime.IsCancellationRequested && (generation.IsCancellationRequested || deadline.IsCancellationRequested))
                { lock (gate) { controlling = false; RenewOrdinary(); if (state.Controls.Any(control => control.Status == "interrupting")) throw new ReceiverFailure(new("unavailable", "Native interruption deadline ended; the exact captured turn remains saved for recovery")); } Change(); if (deadline.IsCancellationRequested) await changed.Wait(TimeSpan.FromMilliseconds(Math.Min(options.PollMs, 5000)), options.Clock, lifetime.Token); }
                catch (ReceiverFailure error)
                {
                    lock (gate) { controlling = false; RenewOrdinary(); } Change();
                    if (generation.IsCancellationRequested && !lifetime.IsCancellationRequested) continue;
                    if (!state.Controls.Any(control => control.Status == "interrupting") && Retryable(error.Failure) && !lifetime.IsCancellationRequested) { await changed.Wait(TimeSpan.FromMilliseconds(Math.Min(options.PollMs, 5000)), options.Clock, lifetime.Token); continue; } throw;
                }
            }
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch (ReceiverFailure error) { Fail(error.Failure); }
        catch (Exception error) when (error is IOException or InvalidDataException or JsonException or ArgumentException or InvalidOperationException or OverflowException) { Fail(new("invalid", "Matrix receiver acquisition failed: " + error.Message)); }
        finally { lock (gate) controlling = false; Change(); }
    }
    private void RenewOrdinary()
    { if (ordinary.IsCancellationRequested) { retired.Add(ordinary); ordinary = new(); if (ordinaryUsers == 0) { foreach (var source in retired) source.Dispose(); retired.Clear(); } } }
    private void ReleaseOrdinary()
    { lock (gate) { ordinaryUsers--; if (ordinaryUsers == 0) { foreach (var source in retired) source.Dispose(); retired.Clear(); } } }
    private async ValueTask Interrupt(ReceivedEvent value, CancellationToken cancellation)
    {
        var source = Take(await ReceivePages.Origins(options.Matrix, options.Profile.Account.UserId, [value], cancellation))[0]; receipts.Publish(source, "received");
        lock (gate) ordinary.Cancel(); var previousPublication = CancelDelivery().AsTask();
        try
        {
            if (Runtime.TurnControl is null)
            {
                await previousPublication; receipts.Publish(source, "failed", "This runtime has no captured-turn interruption capability"); lock (gate) { state = state with { Paused = true, Controls = [..state.Controls, new(value.RoomId, value.EventId, true, null, "delivered")] }; SaveControl(); }
                var policy = Take(await OwnerAuthority.Policy(options.Coordination, options.Profile, cancellation)); if (policy.Rooms.Any(room => room.RoomId == value.RoomId && room.AccessMode != "read" && !room.Muted))
                {
                    var sent = await AgentIO.Request(options.Matrix, new("PUT", AgentWire.Room(value.RoomId) + "/send/m.room.message/crossfire-control-" + Identity.Hash(value.EventId), OwnerNotices.Content("Listener delivery is paused. This runtime connection cannot interrupt the current turn; stop it in the coding session. A subsequent owner message resumes delivery.")), cancellation); if (!sent.IsSuccess && sent.Error.Code != "forbidden") Take(sent);
                }
                return;
            }
            var turn = Take(await Runtime.TurnControl.ActiveTurn(options.HistoryMode == NativeHistoryMode.PerRoom ? value.RoomId : null, new(InputPriority.Steering, cancellation)));
            await Access(cancellation); if (!allowed.Contains(value.RoomId) || !Take(await SteeringControl.Authorized(options.Matrix, options.Coordination, options.Profile, value, senders, cancellation))) { receipts.Publish(source, "failed", "Source or room authority changed before cancellation"); await previousPublication; return; }
            cancellation.ThrowIfCancellationRequested(); SourceControl control;
            lock (gate)
            {
                foreach (var earlier in state.Controls.Where(control => control.Status == "interrupted" && (options.HistoryMode != NativeHistoryMode.PerRoom || control.Room == value.RoomId)).ToArray()) { SetControl(earlier, earlier with { Status = "superseded" }); receipts.Superseded(earlier, source); }
                control = new(value.RoomId, value.EventId, value.Sender == options.Profile.Settings.Owner && WireJson.Text(value.Content, "body")?.Trim() == "!!", turn, "interrupting"); state = state with { Controls = [..state.Controls, control] }; SaveControl();
            }
            var outcome = turn is null ? "inactive" : Take(await Runtime.TurnControl.Interrupt(turn, false, new(InputPriority.Steering, cancellation))); receipts.Publish(source, outcome == "interrupted" ? "interrupted" : "already-idle");
            await previousPublication; lock (gate) { SetControl(control, control with { Status = control.Stop ? "delivered" : "interrupted" }); state = state with { Paused = control.Stop }; SaveControl(); }
        }
        catch (Exception error) when (error is ReceiverFailure or IOException or InvalidDataException or InvalidOperationException or OperationCanceledException)
        { receipts.Publish(source, "failed", error.Message); await previousPublication; throw; }
    }
    private async ValueTask CancelDelivery()
    {
        Sending? current; lock (gate) current = sending; if (current is not null) { try { await current.Cancellation.CancelAsync(); } catch (ObjectDisposedException) { } } if (queries is not null) await queries.Invalidate(); if (current is not null) await current.Done;
    }
    private async ValueTask<T> Retry<T>(Func<ValueTask<Result<T>>> operation, CancellationToken cancellation)
    {
        for (var failures = 0; ; failures++)
        {
            cancellation.ThrowIfCancellationRequested(); var result = await operation(); if (result.IsSuccess) return result.Value; cancellation.ThrowIfCancellationRequested();
            if (!Retryable(result.Error) || failures >= 3) throw new ReceiverFailure(result.Error); await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(options.PollMs, 1000 * (1 << failures))), options.Clock, cancellation);
        }
    }
}
