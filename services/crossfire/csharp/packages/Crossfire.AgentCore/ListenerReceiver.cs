using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed record ListenerOptions(AgentProfile Profile, LocalState Storage, MessagingClient Messaging, Coordination Coordination, ListenerControl Control,
    ListenerBudget Budget, TimeProvider Clock, string CursorFile, string Release, Func<RuntimeHooks, CancellationToken, ValueTask<Result<RuntimeConnection>>> Runtime,
    Func<CancellationToken, ValueTask<Result<IReadOnlyList<string>>>> Invitations, Action<string> Log,
    NativeHistoryMode HistoryMode = NativeHistoryMode.Shared, string? Room = null, int Limit = 100, int PollMs = 1000, int DebounceMs = 1000, int ReconcileMs = 30000,
    Action<string, ListenerController>? Activity = null, Action<Func<CancellationToken, ValueTask<Result<JsonElement>>>, HistoryQueries>? Ready = null, bool MirrorOutput = true);

public sealed partial class ListenerReceiver
{
    private sealed class ReceiverFailure(Failure failure) : Exception(failure.Message) { public Failure Failure { get; } = failure; }
    private sealed class OrdinaryPreempted : Exception { }
    private sealed record Completed(PublicationOutcome Publication, long Membership);
    private sealed record Sending(CancellationTokenSource Cancellation, Task<bool> Done);
    private readonly ListenerOptions options;
    private readonly object gate = new();
    private readonly SemaphoreSlim accessGate = new(1, 1);
    private readonly ListenerSignal changed = new();
    private readonly CancellationTokenSource lifetime;
    private readonly List<CancellationTokenSource> retired = [];
    private int ordinaryUsers;
    private CancellationTokenSource ordinary = new();
    private Failure? failure;
    private RuntimeConnection? destination;
    private ListenerStatistics statistics;
    private OwnerObservation? observer;
    private DecisionBroker? approval;
    private readonly ListenerReporting activity;
    private CancellationTokenRegistration nativeFailure;
    private MessageArtifacts artifacts = null!;
    private ChatPublication chat = null!, priorityChat = null!;
    private ControlledPublication controlled = null!;
    private ScheduledPublication scheduled = null!;
    private HistoryQueries queries = null!;
    private ReleaseNotices updates = null!;
    private ListenerMaintenance maintenance = null!;
    private SteeringReceipts receipts = null!;
    private SourceControlState state = null!;
    private IReadOnlySet<string> allowed = new HashSet<string>(StringComparer.Ordinal), senders = new HashSet<string>(StringComparer.Ordinal), joined = new HashSet<string>(StringComparer.Ordinal);
    private readonly HashSet<string> retiredRooms = new(StringComparer.Ordinal);
    private WakeCycle? cycle;
    private long windowEnd, membershipRevision, revision, lastAccess = long.MinValue;
    private int maximum = AgentIO.DefaultInputBytes;
    private bool controlling, acquiring, synchronized;
    private string? since;
    private Completed? completed;
    private Sending? sending;
    private Task? acquisition;
    private RuntimeConnection Runtime => destination ?? throw new InvalidOperationException("Native receiver is not initialized");
    private LocalState Storage => options.Storage;
    private string File => options.CursorFile;
    private string ControlFile => File + ".control";
    private long Now => options.Clock.GetUtcNow().ToUnixTimeMilliseconds();
    private ListenerReceiver(ListenerOptions options, CancellationToken stop)
    {
        this.options = options; lifetime = CancellationTokenSource.CreateLinkedTokenSource(stop); statistics = new(options.Profile.Account.UserId, options.Clock);
        activity = new(new(options.Coordination, options.Profile.Id, options.Release, options.Control, statistics, options.Clock, options.Log,
            release => { updates.Available(release); Change(); }, (run, binding) => { approval!.Start(); observer!.Start(run); options.Activity?.Invoke(run, binding); }, Fail), lifetime.Token);
    }
    private static T Take<T>(Result<T> value) => value.IsSuccess ? value.Value : throw new ReceiverFailure(value.Error);
    private void Fail(Failure error) { lock (gate) failure ??= error; lifetime.Cancel(); changed.Wake(); }
    private void Change() { Interlocked.Increment(ref revision); changed.Wake(); }
    private void SaveControl() => SteeringControl.Save(Storage, ControlFile, state);
    private SourceControl? Urgent() { lock (gate) return state.Controls.LastOrDefault(value => value.Status == "interrupted"); }
    private IReadOnlySet<string> CurrentRooms() { lock (gate) return allowed.Where(joined.Contains).ToHashSet(StringComparer.Ordinal); }
    private bool PendingInput()
    {
        lock (gate) return destination is null || acquiring || controlling || sending is not null || completed is not null || chat is null || chat.Pending || priorityChat.Pending || controlled.Pending || scheduled.Pending || queries.Pending || cycle is not null || state.Controls.Any(value => value.Status is "interrupting" or "interrupted");
    }
    public static async ValueTask<Result<Unit>> Run(ListenerOptions options, CancellationToken stop)
    {
        if (options.PollMs is < 100 or > 30000 || options.DebounceMs is < 0 or > 60000 || options.ReconcileMs is < 1000 or > 600000 || options.Limit is < 1 or > 100 || options.Room is not null && !Validation.RoomId(options.Room)) return Results.Fail<Unit>("invalid", "Invalid listener polling, collection, reconciliation, page or room configuration");
        var receiver = new ListenerReceiver(options, stop); Result<Unit> result;
        try { await receiver.Initialize(); await receiver.PublishLoop(); result = receiver.failure is null && stop.IsCancellationRequested ? Results.Done() : receiver.failure is null ? Results.Fail<Unit>("unavailable", "Native receiver stopped without an intentional shutdown") : Result<Unit>.Fail(receiver.failure); }
        catch (OperationCanceledException) when (receiver.lifetime.IsCancellationRequested) { result = receiver.failure is null && stop.IsCancellationRequested ? Results.Done() : Result<Unit>.Fail(receiver.failure ?? new("unavailable", "Native receiver ended before completion")); }
        catch (ReceiverFailure error) { result = Result<Unit>.Fail(error.Failure); }
        catch (Exception error) when (error is IOException or InvalidDataException or JsonException or ArgumentException or InvalidOperationException or UnauthorizedAccessException or OverflowException or AggregateException) { result = Results.Fail<Unit>("invalid", "Receiver state or native protocol requires inspection: " + error.Message); }
        try { await receiver.Close(); } catch (Exception error) { if (result.IsSuccess) result = Results.Fail<Unit>("unavailable", "Receiver shutdown did not complete: " + error.Message); }
        return result;
    }
    private async Task Initialize()
    {
        await options.Control.WaitForActivation(lifetime.Token); var release = Take(await options.Coordination.Call(new("release", new Dictionary<string, string>()), lifetime.Token));
        if (WireJson.Text(release, "release") is not { } available || !ReleaseValues.Identity(available) || !ReleaseValues.Identity(options.Release)) throw new ReceiverFailure(new("invalid", "Crossfire software release identity is invalid"));
        observer = new(Storage, File + ".observation", options.Profile, options.Messaging, options.Coordination, options.Clock, options.HistoryMode, () => Volatile.Read(ref maximum), () => destination?.Lifecycle?.Current(), Fail, lifetime.Token, options.MirrorOutput);
        approval = new(options.Profile, options.Coordination, options.Messaging, Storage, File + ".decisions", options.Clock, activity.Ready, lifetime.Token);
        destination = Take(await options.Runtime(new(approval.Request, statistics.Usage, approval.Responded, () => approval.Unresolved, PendingInput, observer.Observe), lifetime.Token));
        nativeFailure = Runtime.Lifetime.Register(() => Fail(new("unavailable", "Owned native runtime connection stopped; exact saved histories and original pending input remain retained")));
        state = SteeringControl.Load(Storage, ControlFile, Runtime.SessionId); since = ReceiveState.SyncCursor(Storage, File); cycle = ReceiveSnapshots.LoadWake(Storage, File);
        receipts = new(options.Clock, observer.Notice); updates = new(Storage, File, options.Release, options.Profile.Settings.Owner, Runtime.SessionId); updates.Available(available);
        artifacts = new(Storage, File + ".messages", () => Now, () => observer.Busy, () =>
        {
            lock (gate) return ReceiveSnapshots.ContentFiles(Storage, File).Concat(chat?.ContentFiles ?? []).Concat(priorityChat?.ContentFiles ?? []).Concat(queries?.ContentFiles ?? []).ToHashSet(StringComparer.Ordinal);
        });
        chat = new(Storage, File + ".chat-publication", options.Profile.Settings, Runtime, options.HistoryMode, () => maximum, artifacts,
            Accept, observer.Delivered, activity.Delivered, events => statistics.Record(events, true));
        priorityChat = new(Storage, File + ".steering-publication", options.Profile.Settings, Runtime, options.HistoryMode, () => maximum, artifacts,
            _ => true, observer.Delivered, activity.Delivered, events => { statistics.Record(events, true); AcceptedSteering(events); }, InputPriority.Steering);
        controlled = new(Storage, File + ".controller-input", options.Control, Runtime, artifacts, () => maximum, options.Clock);
        scheduled = new(Storage, File + ".wake-input", options.Coordination, options.Profile, Runtime, () => new(activity.RunId ?? throw new InvalidOperationException("Scheduled delivery requires a reporting listener"), Runtime.SessionId), artifacts, () => maximum, options.Clock);
        queries = new(Storage, File, options.Messaging, options.Profile, options.Coordination, options.Clock, artifacts,
            () => { lock (gate) return chat.Pending || priorityChat.Pending || state.Controls.Any(value => value.Status is "interrupting" or "interrupted") || completed is not null; },
            events => statistics.Record(events, false), events => { statistics.Record(events, true); activity.Delivered(events.Count(value => value.Type == "message")); },
            () => { lock (gate) { cycle = null; ReceiveSnapshots.SaveWake(Storage, File, null); windowEnd = 0; } Change(); }, lifetime.Token, gate);
        maintenance = new(Storage, File + ".maintenance", options.Profile.Id, options.Coordination, options.Clock, options.ReconcileMs, options.Invitations);
        Take(await OwnerAuthority.Authorize(options.Coordination, options.Messaging, options.Profile, lifetime.Token)); await Access(lifetime.Token); Take(await ReceiveState.Flush(Storage, options.Messaging, File, lifetime.Token));
        foreach (var control in state.Controls.Where(value => value.Status == "interrupting"))
        {
            if (control.Turn is not null) { if (Runtime.TurnControl is null) throw new ReceiverFailure(new("invalid", "Native turn cancellation is unavailable for this attachment")); Take(await Runtime.TurnControl.Interrupt(control.Turn, true, new(InputPriority.Steering, lifetime.Token))); }
            SetControl(control, control with { Status = control.Stop ? "delivered" : "interrupted" }); state = state with { Paused = control.Stop }; SaveControl();
        }
        joined = Take(await ReceivePages.Joined(options.Messaging, lifetime.Token)); SyncEvents.RetainJoined(Storage, File, joined); options.Control.Changed += ControlChanged; await Activate();
        options.Ready?.Invoke(Diagnose, queries); acquisition = AcquireLoop();
    }
    private bool Accept(ReceivedEvent value)
    { lock (gate) return !ReceivedEvents.Notice(value) && !(value.Type == "message" && value.Sender == options.Profile.Account.UserId) && !state.Controls.Any(control => control.Room == value.RoomId && control.Event == value.EventId && control.Status == "delivered"); }
    private void SetControl(SourceControl original, SourceControl replacement)
    { lock (gate) state = state with { Controls = state.Controls.Select(control => control == original ? replacement : control).ToArray() }; }
    private void AcceptedSteering(IReadOnlyList<ReceivedEvent> events)
    {
        lock (gate) { foreach (var value in events) { var control = state.Controls.FirstOrDefault(control => control.Room == value.RoomId && control.Event == value.EventId); if (control?.Status != "delivered") receipts.Publish(value, "accepted"); if (control is not null) SetControl(control, control with { Status = "delivered" }); } SaveControl(); } Change();
    }
    private void ControlChanged() { if (!options.Control.Current().Active) { Interlocked.Increment(ref membershipRevision); lock (gate) sending?.Cancellation.Cancel(); } Change(); }
    private async ValueTask<bool> Activate() => Take(await activity.Activate());
    private ValueTask PauseActivity() => activity.Pause();
    private async ValueTask Close()
    {
        List<Exception> errors = []; async Task Finish(Func<Task> action) { try { await action(); } catch (Exception error) { errors.Add(error); } }
        await Finish(lifetime.CancelAsync); options.Control.Changed -= ControlChanged; changed.Wake(); Sending? current; lock (gate) current = sending;
        if (current is not null) await Finish(async () => { try { await current.Cancellation.CancelAsync(); } catch (ObjectDisposedException) { } await current.Done; });
        if (acquisition is not null) await Finish(() => acquisition); if (queries is not null) await Finish(() => queries.Invalidate().AsTask()); nativeFailure.Unregister();
        if (approval is not null) await Finish(() => approval.DisposeAsync().AsTask()); if (observer is not null) await Finish(() => observer.DisposeAsync().AsTask()); await Finish(() => PauseActivity().AsTask()); if (destination is not null) await Finish(() => destination.DisposeAsync().AsTask());
        ordinary.Dispose(); foreach (var source in retired) source.Dispose(); accessGate.Dispose(); changed.Dispose(); lifetime.Dispose(); if (errors.Count != 0) throw new AggregateException("Receiver shutdown requires inspection", errors);
    }
    private static bool Retryable(Failure error) => error.Code is "native" or "unavailable" or "body_too_large";
}
