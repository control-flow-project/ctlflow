using Crossfire.Domain;
using Crossfire.AgentCore;
using Crossfire.Kernel;
using Fleetd.Domain;

namespace Fleetd.Domain.Tests;

public static class NativeLazyAcceptance
{
    public static async Task Run(Action<bool, string> check)
    {
        var fixtures = Enumerable.Range(0, 100).Select(_ => new Harness { PendingDecision = true }).ToArray();
        for (var restart = 0; restart < 3; restart++)
        {
            var owners = await Task.WhenAll(fixtures.Select(fixture => fixture.Open()));
            try
            {
                foreach (var owner in owners)
                {
                    check(owner.Current().Phase == "sleeping", "Every restored agent is lazy");
                    check((await owner.Runtime.Settle()).IsSuccess, "Idle settlement needs no native runtime");
                    check(owner.Runtime.Acknowledge([]).IsSuccess, "Empty receipts never wake a runtime");
                    check((await owner.Diagnostics(CancellationToken.None)).PendingDecision, "Unanswered owner decisions remain visible without waking history");
                    check(owner.Contexts().Value.Single().SessionId == Harness.Session, "Metadata preserves the exact native identity");
                    check((await owner.Activate()).IsSuccess, "Repeated listener activation is idempotent");
                }
                if (restart == 2)
                {
                    check((await owners[37].Runtime.Deliver("Actual selected input", "selected")).IsSuccess, "A genuine input wakes its selected agent");
                    check(owners[37].Runtime.Acknowledge(["selected"]).IsSuccess, "Accepted input retains receipt retirement");
                }
                check(fixtures.Sum(fixture => fixture.Starts) == (restart == 2 ? 1 : 0), "A 100-agent restart never fans out native startup");
                check(fixtures.Sum(fixture => fixture.Inputs.Count) == (restart == 2 ? 1 : 0), "A 100-agent restart submits zero unsolicited inputs");
            }
            finally { foreach (var owner in owners) await owner.DisposeAsync(); }
        }
        var fixture = new Harness();
        fixture.Receipts.Add("producer-receipt");
        await using (var owner = await fixture.Open())
        {
            var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            fixture.SettlementBarrier = () => { entered.TrySetResult(); return new(release.Task); };
            var waking = owner.Resume().AsTask(); await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            var retired = owner.Runtime.Acknowledge(["producer-receipt"]); var retained = fixture.Receipts.Contains("producer-receipt");
            release.TrySetResult(); var ready = await waking;
            check(!retired.IsSuccess && retired.Error.Code == "unavailable", "Native receipts remain fenced during exact-history activation");
            check(retained && ready.IsSuccess, "Activation cannot retire the original receipt prematurely");
            check(owner.Runtime.Acknowledge(["producer-receipt"]).IsSuccess && fixture.Receipts.Count == 0, "Receipt retirement succeeds after native initialization");
            check(fixture.Inputs.Count == 0, "Explicit native metadata activation never submits a dummy input");
        }
        fixture = new Harness();
        var current = await fixture.Open();
        try
        {
            check((await current.Runtime.Deliver("Unfinished task", "unfinished")).IsSuccess, "Real input is submitted");
            current.Runtime.Acknowledge(["unfinished"]);
            for (var restart = 0; restart < 2; restart++)
            {
                await current.DisposeAsync(); current = await fixture.Open();
                check(fixture.Starts == 1 && fixture.Inputs.Count == 1, "Unfinished historical work never synthesizes a restart turn");
                check(current.Runtime.SessionId == Harness.Session && current.Current().Phase == "sleeping", "Restored histories remain exact and lazy");
            }
            var results = await Task.WhenAll(current.Runtime.Deliver("New input", "new").AsTask(), current.Runtime.Deliver("Other input", "other").AsTask());
            check(results.All(result => result.IsSuccess) && fixture.Starts == 2, "Concurrent genuine inputs share a single native generation");
            check(fixture.Inputs.Select(input => input.Id).SequenceEqual(new[] { "unfinished", "new", "other" }), "Only genuine inputs reach native delivery");
        }
        finally { await current.DisposeAsync(); }
        fixture = new Harness();
        var unsafeOwner = await fixture.Open();
        check((await unsafeOwner.Runtime.Deliver("Actual input", "before-cleanup")).IsSuccess, "The owned generation accepts its genuine input");
        fixture.FailClose = true;
        fixture.Native!.Crash();
        await Until(() => fixture.Closes != 0);
        var blocked = await unsafeOwner.Runtime.Deliver("Must not create another writer", "blocked");
        check(!blocked.IsSuccess && blocked.Error.Code == "conflict" && fixture.Starts == 1, "Unverified cleanup cannot open a competing native generation");
        fixture.FailClose = false; await unsafeOwner.DisposeAsync();
        fixture = new Harness { WrongHistory = true };
        await using (var owner = await fixture.Open())
        {
            var rejected = await owner.Runtime.Deliver("Must retain the original history", "wrong-history");
            check(!rejected.IsSuccess && rejected.Error.Code == "conflict", "A different native identity is rejected at genuine wake");
            check(fixture.Starts == 1 && fixture.Closes == 1 && fixture.Inputs.Count == 0, "Identity conflicts close their exact generation before any input");
        }
        fixture = new Harness { WrongHistory = true, FailClose = true };
        var rejectedOwner = await fixture.Open();
        try
        {
            var rejected = await rejectedOwner.Runtime.Deliver("Reject wrong history", "wrong-history-cleanup");
            check(!rejected.IsSuccess && rejected.Error.Code == "conflict", "A rejected startup retains its failed cleanup fence");
            var replacement = await rejectedOwner.Runtime.Deliver("No competing native owner", "blocked-replacement");
            check(!replacement.IsSuccess && fixture.Starts == 1 && fixture.Inputs.Count == 0, "Failed cleanup of a rejected startup cannot admit another native generation");
        }
        finally { fixture.FailClose = false; await rejectedOwner.DisposeAsync(); }
        fixture = new Harness();
        fixture.Contexts.Add(new("room/control", "codex", "room-history", "/fixture"));
        await using (var owner = await fixture.Open())
        {
            var room = (await owner.Runtime.Conversation("control")).Value;
            check((await room.Deliver("Room input", "room")).IsSuccess && room.SessionId == "room-history", "Room delivery retains the exact room history");
            await room.TurnControl!.ActiveTurn(); check(fixture.CapturedRooms[^1] == "control", "A selected room defaults native inspection to its own history");
        }
    }

    private static async Task Until(Func<bool> ready)
    {
        var deadline = Environment.TickCount64 + 5000;
        while (!ready()) { if (Environment.TickCount64 >= deadline) throw new TimeoutException("Native lifecycle observation deadline"); await Task.Yield(); }
    }

    private sealed class Harness
    {
        public const string Session = "00000000-0000-4000-8000-000000000001";
        public List<(string Id, string Text)> Inputs { get; } = [];
        public HashSet<string> Receipts { get; } = new(StringComparer.Ordinal);
        public List<SavedRuntimeContext> Contexts { get; } = [new("shared", "codex", Session, "/fixture")];
        public Dictionary<string, bool> ContextBusy { get; } = new(StringComparer.Ordinal);
        public List<string?> CapturedRooms { get; } = [];
        public Func<ValueTask>? ActivityBarrier { get; set; }
        public Func<ValueTask>? SettlementBarrier { get; set; }
        public Action<RuntimeObservationEvent>? Observe { get; private set; }
        public Probe? Native { get; private set; }
        public int Starts { get; private set; }
        public int Closes { get; set; }
        public bool FailClose { get; set; }
        public bool WrongHistory { get; set; }
        public bool PendingDecision { get; set; }
        public async Task<NativeLifecycle> Open(bool activate = true)
        {
            var hooks = new RuntimeHooks((_, _) => ValueTask.FromResult(Results.Fail<System.Text.Json.JsonElement>("forbidden", "Unexpected fixture decision")), PendingDecisions: () => PendingDecision);
            var services = new NativeLifecycleServices("codex", RuntimeApproval.Listener, "shared", false, [], hooks,
                () => Result<IReadOnlyList<SavedRuntimeContext>>.Success(Contexts.ToArray()),
                (observe, _, _) => {
                    Starts++; Observe = observe; Native = new(this, WrongHistory ? "wrong-history" : Session); observe(new NativeState("codex", Session, null, "idle", 1000, [], null));
                    return ValueTask.FromResult(Result<OwnedRuntimeConnection>.Success(Native));
                }, (_, _) => { }, () => { }, TimeProvider.System);
            var opened = await NativeLifecycle.Start(services, CancellationToken.None);
            if (!opened.IsSuccess) throw new InvalidOperationException(opened.Error.Message);
            if (activate) { var active = await opened.Value.Activate(); if (!active.IsSuccess) { await opened.Value.DisposeAsync(); throw new InvalidOperationException(active.Error.Message); } }
            return opened.Value;
        }
    }

    private sealed class Probe(Harness fixture, string session = Harness.Session) : OwnedRuntimeConnection, TurnControl
    {
        public ValueTask<Result<ProviderState>> Provider(CancellationToken cancellation) => ValueTask.FromResult(Result<ProviderState>.Success(ProviderState.Unknown));
        private readonly CancellationTokenSource stop = new();
        public bool Busy { get; set; }
        public Func<ValueTask<Result<bool>>>? Inspection { get; set; }
        public string SessionId => session;
        public RuntimeApproval Approval => RuntimeApproval.Listener;
        public CancellationToken Lifetime => stop.Token;
        public TurnControl TurnControl => this;
        public RuntimeLifecycle? Lifecycle => null;
        public RuntimeAttachment? Attachment => null;
        public ValueTask<Result<IReadOnlyList<ContextAttachment>>> Attachments() => ValueTask.FromResult(Result<IReadOnlyList<ContextAttachment>>.Success([]));
        public ValueTask<Result<bool>> Inspect() => Inspection is { } inspect ? inspect() : ValueTask.FromResult(Result<bool>.Success(Busy || fixture.Receipts.Count != 0));
        public async ValueTask<Result<NativeActivity>> Activity()
        {
            if (fixture.ActivityBarrier is { } barrier) await barrier();
            if (fixture.ContextBusy.Count == 0) return (await Inspect()).Map(value => new NativeActivity(value, [new("shared", SessionId, value)]));
            var contexts = fixture.Contexts.Select(value => new NativeContextActivity(value.Context, value.SessionId, fixture.ContextBusy.GetValueOrDefault(value.SessionId))).ToArray();
            return Result<NativeActivity>.Success(new(contexts.Any(value => value.Busy), contexts));
        }
        public ValueTask<Result<Unit>> Deliver(string text, string messageId, CancellationToken cancellation = default, InputPriority? priority = null)
        {
            cancellation.ThrowIfCancellationRequested();
            fixture.Inputs.Add((messageId, text)); fixture.Receipts.Add(messageId); Busy = true; return ValueTask.FromResult(Results.Done());
        }
        public async ValueTask<Result<bool>> Settle(CancellationToken cancellation = default)
        { if (fixture.SettlementBarrier is { } barrier) await barrier(); return Result<bool>.Success(false); }
        public ValueTask<Result<bool>> Recover(string text, string messageId, CancellationToken cancellation = default) => ValueTask.FromResult(Result<bool>.Success(false));
        public Result<Unit> Acknowledge(IReadOnlyList<string> messageIds) { foreach (var id in messageIds) fixture.Receipts.Remove(id); return Results.Done(); }
        public ValueTask<Result<RuntimeConnection>> Conversation(string room, InputAdmission? admission = null)
            => ValueTask.FromResult(fixture.Contexts.FirstOrDefault(value => value.Context == HistoryContext.ForRoom(room)) is { } context
                ? Result<RuntimeConnection>.Success(new Probe(fixture, context.SessionId)) : Results.Fail<RuntimeConnection>("missing", "No room history in this fixture"));
        public ValueTask<Result<string?>> ActiveTurn(string? room = null, InputAdmission? admission = null) { fixture.CapturedRooms.Add(room); return ValueTask.FromResult(Result<string?>.Success(null)); }
        public ValueTask<Result<string>> Interrupt(string turnId, bool recovery = false, InputAdmission? admission = null) => ValueTask.FromResult(Result<string>.Success("inactive"));
        public void Crash() => stop.Cancel();
        public ValueTask DisposeAsync()
        {
            fixture.Closes++;
            if (fixture.FailClose) throw new IOException("Controlled native cleanup failure");
            stop.Cancel(); return ValueTask.CompletedTask;
        }
    }
}
