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
                check(fixture.Inputs[^1].Id == previous.MessageId && fixture.Inputs[^1].Text.StartsWith("[Crossfire session restarted]", StringComparison.Ordinal),
                    "The exact saved history receives its restart notice");
            }
            fixture.Native!.Busy = false;
            check(!(await current.Runtime.Inspect()).Value && fixture.Work.Count == 0, "Completion after repeated restarts clears the retained task");
        }
        finally { await current.DisposeAsync(); }
    }

    private sealed class Harness
    {
        public const string Session = "00000000-0000-4000-8000-000000000001";
        private readonly List<ResumeWork> work = [];
        public IReadOnlyList<ResumeWork> Work => work;
        public List<(string Id, string Text)> Inputs { get; } = [];
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
                    if (index < 0) return Results.Fail<Unit>("conflict", "Checkpoint changed before resume");
                    work[index] = work[index] with { MessageId = Identity.Identifier() }; return Results.Done();
                }, () => { work.Clear(); return Results.Done(); });
            var hooks = new RuntimeHooks((_, _) => ValueTask.FromResult(Results.Fail<System.Text.Json.JsonElement>("forbidden", "Unexpected fixture decision")));
            var services = new NativeLifecycleServices("codex", RuntimeApproval.Listener, "shared", initial, [], hooks, store,
                () => Result<IReadOnlyList<SavedRuntimeContext>>.Success([new("shared", "codex", Session, "/fixture")]),
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

    private sealed class Probe(Harness fixture) : OwnedRuntimeConnection, TurnControl
    {
        private readonly CancellationTokenSource stop = new();
        public bool Busy { get; set; }
        public Func<ValueTask<Result<bool>>>? Inspection { get; set; }
        public string SessionId => Harness.Session;
        public RuntimeApproval Approval => RuntimeApproval.Listener;
        public CancellationToken Lifetime => stop.Token;
        public TurnControl TurnControl => this;
        public RuntimeLifecycle? Lifecycle => null;
        public RuntimeAttachment? Attachment => null;
        public ValueTask<Result<IReadOnlyList<ContextAttachment>>> Attachments() => ValueTask.FromResult(Result<IReadOnlyList<ContextAttachment>>.Success([]));
        public ValueTask<Result<bool>> Inspect() => Inspection is { } inspect ? inspect() : ValueTask.FromResult(Result<bool>.Success(Busy));
        public ValueTask<Result<Unit>> Deliver(string text, string messageId, CancellationToken cancellation = default, InputPriority? priority = null)
        {
            cancellation.ThrowIfCancellationRequested();
            if (fixture.Work.Count != 1 || fixture.Work[0].SessionId != SessionId) throw new InvalidOperationException("Missing write-ahead checkpoint");
            fixture.Inputs.Add((messageId, text)); Busy = true; return ValueTask.FromResult(Results.Done());
        }
        public ValueTask<Result<bool>> Settle(CancellationToken cancellation = default) => ValueTask.FromResult(Result<bool>.Success(false));
        public ValueTask<Result<bool>> Recover(string text, string messageId, CancellationToken cancellation = default) => ValueTask.FromResult(Result<bool>.Success(false));
        public Result<Unit> Acknowledge(IReadOnlyList<string> messageIds) => Results.Done();
        public ValueTask<Result<RuntimeConnection>> Conversation(string room, InputAdmission? admission = null) => ValueTask.FromResult(Results.Fail<RuntimeConnection>("invalid", "No room history in this fixture"));
        public ValueTask<Result<string?>> ActiveTurn(string? room = null, InputAdmission? admission = null) => ValueTask.FromResult(Result<string?>.Success(null));
        public ValueTask<Result<string>> Interrupt(string turnId, bool recovery = false, InputAdmission? admission = null) => ValueTask.FromResult(Result<string>.Success("inactive"));
        public ValueTask DisposeAsync() { stop.Cancel(); return ValueTask.CompletedTask; }
    }
}
