using Crossfire.AgentCore;
using Crossfire.Kernel;
using Fleetd.Domain;

namespace Fleetd.Domain.Tests;

public static class NativeWorkAcceptance
{
    public static async Task Run(Action<bool, string> check)
    {
        var fixture = new Harness();
        await using (var owner = await fixture.Open("running"))
        {
            check((await owner.Runtime.Deliver("First task", "first")).IsSuccess, "Submission succeeds after its durable checkpoint");
            check(fixture.Work.Count == 1 && fixture.Inputs.Count == 1, "Native input cannot precede its exact-history checkpoint");
            owner.Runtime.Acknowledge(["first"]);
            fixture.Observe!(new NativeState("codex", Harness.Session, null, "idle", 1000, [], null));
            check((await owner.Runtime.Inspect()).Value && fixture.Work.Count == 1, "A delayed idle notification cannot clear active native work");
            var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var release = new TaskCompletionSource<Result<bool>>(TaskCreationOptions.RunContinuationsAsynchronously);
            fixture.Native!.Inspection = () => { entered.TrySetResult(); return new(release.Task); };
            var older = owner.Runtime.Inspect().AsTask(); await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            check((await owner.Runtime.Deliver("Newer task", "newer")).IsSuccess, "New input may arrive during an older native inspection");
            owner.Runtime.Acknowledge(["newer"]); release.SetResult(Result<bool>.Success(false)); await older;
            check(fixture.Work.Count == 1, "An older idle query cannot erase newer input");
            fixture.Native.Inspection = null; fixture.Native.Busy = false;
            check(!(await owner.Runtime.Inspect()).Value && fixture.Work.Count == 0, "Verified idle clears completed work in one operation");
            fixture.FailCapture = true;
            check(!(await owner.Runtime.Deliver("Rejected write", "rejected")).IsSuccess && fixture.Inputs.Count == 2, "Failed persistence prevents native submission");
        }
        fixture = new Harness();
        var current = await fixture.Open("running");
        try
        {
            check((await current.Runtime.Deliver("Unfinished task", "unfinished")).IsSuccess, "Initial unfinished task is submitted");
            current.Runtime.Acknowledge(["unfinished"]);
            for (var restart = 0; restart < 2; restart++)
            {
                var previous = fixture.Work.Single(); await current.DisposeAsync();
                check(fixture.Work.Count == 1, "Stopping an active native task retains its checkpoint");
                current = await fixture.Open("sleeping");
                check(fixture.Work.Count == 1 && fixture.Work[0].SessionId == Harness.Session && fixture.Work[0].MessageId != previous.MessageId,
                    "Every restart renews its reminder identity without deleting unfinished work");
                check(fixture.Inputs[^1].Id == fixture.Work[0].MessageId && fixture.Inputs[^1].Text.StartsWith("[Crossfire session restarted]", StringComparison.Ordinal),
                    "The exact saved history receives its restart notice");
                check(fixture.Receipts.Count == 0, "Restart acknowledges its exact reminder without stranding native evidence");
            }
            fixture.Native!.Busy = false;
            check(!(await current.Runtime.Inspect()).Value && fixture.Work.Count == 0, "Completion after repeated restarts clears the retained task");
        }
        finally { await current.DisposeAsync(); }
        foreach (var action in new[] { "inspect", "stop", "stop-during-inspection" })
        {
            fixture = new Harness();
            fixture.Contexts.AddRange([new("!active:fixture", "codex", "active-history", "/fixture"), new("!completed:fixture", "codex", "completed-history", "/fixture")]);
            fixture.ContextBusy["active-history"] = true; fixture.ContextBusy["completed-history"] = false;
            var owner = await fixture.Open("running");
            var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            Task<Result<bool>>? older = null;
            try
            {
                var completed = (await owner.Runtime.Conversation("!completed:fixture")).Value;
                check((await completed.Deliver("Completed room task", "completed")).IsSuccess, "Room submission has an exact durable checkpoint"); completed.Acknowledge(["completed"]);
                var active = (await owner.Runtime.Conversation("!active:fixture")).Value;
                check((await active.Deliver("Unfinished room task", "active")).IsSuccess && fixture.Work.Count == 2, "Both room tasks are independently checkpointed");
                await active.TurnControl!.ActiveTurn(); check(fixture.CapturedRooms[^1] == "!active:fixture", "A room defaults turn inspection to its own native history");
                if (action == "stop-during-inspection")
                {
                    fixture.ActivityBarrier = () => { fixture.ActivityBarrier = null; entered.SetResult(); return new(release.Task); };
                    older = owner.Runtime.Inspect().AsTask(); await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
                }
                if (action == "inspect") check((await owner.Runtime.Inspect()).Value, "Another room remains busy after exact-context inspection");
                else await owner.DisposeAsync();
                release.TrySetResult(); if (older is not null) await older;
                check(fixture.Work.Count == 1 && fixture.Work[0].Context == "!active:fixture", "Inspection and stop clear only the verified completed room");
            }
            finally { release.TrySetResult(); if (older is not null) await older; await owner.DisposeAsync(); }
        }
    }

    private sealed class Harness
    {
        public const string Session = "00000000-0000-4000-8000-000000000001";
        private readonly List<ResumeWork> work = [];
        public IReadOnlyList<ResumeWork> Work => work;
        public List<(string Id, string Text)> Inputs { get; } = [];
        public HashSet<string> Receipts { get; } = new(StringComparer.Ordinal);
        public List<SavedRuntimeContext> Contexts { get; } = [new("shared", "codex", Session, "/fixture")];
        public Dictionary<string, bool> ContextBusy { get; } = new(StringComparer.Ordinal);
        public List<string?> CapturedRooms { get; } = [];
        public Func<ValueTask>? ActivityBarrier { get; set; }
        public bool FailCapture { get; set; }
        public Action<RuntimeObservationEvent>? Observe { get; private set; }
        public Probe? Native { get; private set; }
        private Result<Unit> Capture(IReadOnlyList<InterruptedContext> contexts)
        {
            if (FailCapture) return Results.Fail<Unit>("unavailable", "Controlled checkpoint write failure");
            foreach (var context in contexts) if (!work.Any(value => value.Context == context.Context)) work.Add(new(context.Context, context.SessionId, Identity.Identifier(), 1000));
            return Results.Done();
        }
        public async Task<NativeLifecycle> Open(string initial)
        {
            var store = new ResumeWorkStore(() => Result<IReadOnlyList<ResumeWork>>.Success(work.ToArray()), Capture,
                id => {
                    var index = work.FindIndex(value => value.MessageId == id);
                    if (index < 0) return Results.Fail<ResumeWork>("conflict", "Checkpoint changed before resume");
                    work[index] = work[index] with { MessageId = Identity.Identifier() }; return Result<ResumeWork>.Success(work[index]);
                }, contexts => { var selected = contexts.ToDictionary(value => value.Context, value => value.SessionId, StringComparer.Ordinal); work.RemoveAll(value => selected.GetValueOrDefault(value.Context) == value.SessionId); return Results.Done(); });
            var hooks = new RuntimeHooks((_, _) => ValueTask.FromResult(Results.Fail<System.Text.Json.JsonElement>("forbidden", "Unexpected fixture decision")));
            var services = new NativeLifecycleServices("codex", RuntimeApproval.Listener, "shared", initial, [], hooks, store,
                () => Result<IReadOnlyList<SavedRuntimeContext>>.Success(Contexts.ToArray()),
                (observe, _, _) => {
                    Observe = observe; Native = new(this); observe(new NativeState("codex", Session, null, "idle", 1000, [], null));
                    return ValueTask.FromResult(Result<OwnedRuntimeConnection>.Success(Native));
                }, (_, _) => { }, () => { }, TimeProvider.System);
            var opened = await NativeLifecycle.Start(services, CancellationToken.None);
            if (!opened.IsSuccess) throw new InvalidOperationException(opened.Error.Message);
            var active = await opened.Value.Activate(); if (!active.IsSuccess) { await opened.Value.DisposeAsync(); throw new InvalidOperationException(active.Error.Message); }
            return opened.Value;
        }
    }

    private sealed class Probe(Harness fixture, string session = Harness.Session) : OwnedRuntimeConnection, TurnControl
    {
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
            if (!fixture.Work.Any(value => value.SessionId == SessionId)) throw new InvalidOperationException("Missing write-ahead checkpoint");
            fixture.Inputs.Add((messageId, text)); fixture.Receipts.Add(messageId); Busy = true; return ValueTask.FromResult(Results.Done());
        }
        public ValueTask<Result<bool>> Settle(CancellationToken cancellation = default) => ValueTask.FromResult(Result<bool>.Success(false));
        public ValueTask<Result<bool>> Recover(string text, string messageId, CancellationToken cancellation = default) => ValueTask.FromResult(Result<bool>.Success(false));
        public Result<Unit> Acknowledge(IReadOnlyList<string> messageIds) { foreach (var id in messageIds) fixture.Receipts.Remove(id); return Results.Done(); }
        public ValueTask<Result<RuntimeConnection>> Conversation(string room, InputAdmission? admission = null)
            => ValueTask.FromResult(fixture.Contexts.FirstOrDefault(value => value.Context == room) is { } context
                ? Result<RuntimeConnection>.Success(new Probe(fixture, context.SessionId)) : Results.Fail<RuntimeConnection>("missing", "No room history in this fixture"));
        public ValueTask<Result<string?>> ActiveTurn(string? room = null, InputAdmission? admission = null) { fixture.CapturedRooms.Add(room); return ValueTask.FromResult(Result<string?>.Success(null)); }
        public ValueTask<Result<string>> Interrupt(string turnId, bool recovery = false, InputAdmission? admission = null) => ValueTask.FromResult(Result<string>.Success("inactive"));
        public ValueTask DisposeAsync() { stop.Cancel(); return ValueTask.CompletedTask; }
    }
}
