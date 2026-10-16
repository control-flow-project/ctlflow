using Crossfire.AgentCore;
using Crossfire.Domain;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class ChatPublicationAcceptance
{
    public static async Task Verify()
    {
        var values = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var storage = new LocalState(values.ContainsKey, (file, _) => values[file], (file, bytes, _) => values[file] = bytes.ToArray(), file => values.Remove(file));
        await using var runtime = new MemoryRuntime();
        var settings = new AgentSettings("proof", "https://matrix.test", "test", "@owner:test", 100000);
        var artifacts = new MessageArtifacts(storage, "messages", () => 0, () => false, () => new HashSet<string>());
        var publication = new ChatPublication(storage, "publication", settings, runtime, NativeHistoryMode.Shared, () => 65536, artifacts,
            _ => true, (_, _) => ValueTask.FromResult(Results.Done()), _ => { }, _ => { });
        var events = new ReceivedEvent[] { new("!alpha:test", new("room", "Alpha", null), "$alpha", settings.Owner, "m.room.message",
            WireJson.Object(writer => { writer.WriteString("msgtype", "m.text"); writer.WriteString("body", "Unread input"); }), "2026-10-15T00:00:00.000Z") };
        var cursors = new Dictionary<string, string> { ["!alpha:test"] = "cursor-alpha" };
        var batch = new ReadBatch(events, cursors, [], new Dictionary<string, string> { ["!alpha:test"] = "$alpha" });
        var identities = new Dictionary<string, PrincipalIdentity> { [settings.Owner] = new(settings.Owner, "human", null, "Owner", null) };
        foreach (var selected in new IReadOnlyList<ReceivedEvent>[] { [], events })
        {
            Equal(publication.Prepare(batch, selected, identities).IsSuccess, true, "ordinary input is durably prepared");
            Equal(publication.Unpublished, true, "empty and wholly unsent plans have no native receipt to settle");
            Equal(publication.DiscardUnpublished().IsSuccess, true, "pause releases an unsent reservation");
            Equal(publication.Pending, false, "unsent reservation no longer blocks unread queries");
            Equal(values.ContainsKey("publication"), false, "released plan has no stale journal");
        }
        Equal(runtime.Inputs, 0, "releasing prepared input makes no model call"); Equal(cursors["!alpha:test"], "cursor-alpha", "releasing work does not advance cursors");
        Equal(publication.Prepare(batch, events, identities).IsSuccess, true, "real input is prepared again from its unread position");
        runtime.Uncertain = true; var allowed = new HashSet<string> { "!alpha:test" };
        Equal((await publication.Publish(allowed, CancellationToken.None)).IsSuccess, false, "uncertain native input remains recoverable");
        Equal(publication.Unpublished, false, "publication attempt cannot be classified as unsent"); Equal(publication.DiscardUnpublished().IsSuccess, false, "pause cannot discard uncertain native evidence");
        Equal((await publication.Recover(allowed, CancellationToken.None)).IsSuccess, true, "native receipt resolves the original input");
        Equal(publication.Unpublished, false, "delivered input still requires acknowledgment"); Equal(publication.DiscardUnpublished().IsSuccess, false, "delivered evidence cannot be dropped as unsent");
        Equal(publication.Acknowledge().IsSuccess, true, "exact confirmed publication can be acknowledged"); Equal(runtime.Inputs, 1, "receipt recovery does not replay the original input");
    }
    private sealed class MemoryRuntime : RuntimeConnection
    {
        public int Inputs { get; private set; }
        public bool Uncertain { get; set; }
        public string SessionId => "same-session";
        public RuntimeApproval Approval => RuntimeApproval.None;
        public CancellationToken Lifetime => CancellationToken.None;
        public TurnControl? TurnControl => null;
        public RuntimeLifecycle? Lifecycle => null;
        public ValueTask<Result<bool>> Inspect() => ValueTask.FromResult(Result<bool>.Success(false));
        public ValueTask<Result<Unit>> Deliver(string text, string messageId, CancellationToken cancellation = default, InputPriority? priority = null)
        { Inputs++; return ValueTask.FromResult(Uncertain ? Results.Fail<Unit>("unavailable", "Receipt is uncertain") : Results.Done()); }
        public ValueTask<Result<bool>> Settle(CancellationToken cancellation = default) => ValueTask.FromResult(Result<bool>.Success(true));
        public ValueTask<Result<bool>> Recover(string text, string messageId, CancellationToken cancellation = default) => ValueTask.FromResult(Result<bool>.Success(true));
        public Result<Unit> Acknowledge(IReadOnlyList<string> messageIds) => Results.Done();
        public ValueTask<Result<RuntimeConnection>> Conversation(string room, InputAdmission? admission = null) => ValueTask.FromResult(Result<RuntimeConnection>.Success(this));
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
