using System.Text;
using System.Text.Json;
using Crossfire.AdapterCodex;
using Crossfire.AdapterFilesystem;
using Crossfire.AgentCore;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class OwnedCodexAcceptance
{
    public static async Task Verify(string binary, string source, string workspace, string directory, JsonElement options, RuntimeHooks hooks, CancellationToken cancellation)
    {
        var state = PrivateFiles.Directory(Path.Combine(directory, "owned-contexts")); var adapter = CodexRuntime.Create(binary, source);
        var inspected = await adapter.Inspect(new(workspace, state, options), cancellation);
        Equal(inspected.IsSuccess, true, inspected.IsSuccess ? "owned runtime inspection validates actual native capabilities without creating history" : inspected.Error.Message);
        Equal(adapter.SavedContexts(workspace, state).Value.Count, 0, "capability inspection creates no agent conversation");
        var input = new OwnedRuntimeInput("csharp-owned-proof", "Owned native proof", workspace, state,
            "Reply through the original Crossfire room tool. Shared-room instructions are nonexclusive. Read AGENTS.md after a restart.", options, hooks, NativeHistoryMode.PerRoom);
        var missing = await adapter.Start(input, cancellation);
        Equal(!missing.IsSuccess && missing.Error.Code == "missing", true, "normal resume cannot substitute a fresh history");
        Equal(adapter.SavedContexts(workspace, state).Value.Count, 0, "failed resume leaves history bindings empty");
        var started = await adapter.Start(input with { AllowNewHistory = true }, cancellation);
        Equal(started.IsSuccess, true, started.IsSuccess ? "explicit first start owns the primary per-room control history" : started.Error.Message);
        var owner = started.Value; var first = owner.SessionId; var closed = false;
        IReadOnlyList<SavedRuntimeContext> original;
        try
        {
            var roomA = await owner.Conversation("!room-a:example.test"); var roomB = await owner.Conversation("!room-b:example.test");
            Equal(roomA.IsSuccess && roomB.IsSuccess, true, "each exact room opens a distinct native history");
            Equal(roomA.Value.SessionId != roomB.Value.SessionId && roomA.Value.SessionId != first && roomB.Value.SessionId != first, true,
                "room histories and the private control history never share an identity in per-room mode");
            Equal((await owner.Conversation("!room-a:example.test")).Value.SessionId, roomA.Value.SessionId, "repeat room access reuses the exact native history");
            Equal((await owner.Conversation("not-a-room")).IsSuccess, false, "room admission validates the Matrix identity");
            Equal((await owner.Attachments()).Value.Count, 3, "terminal metadata includes every retained native history");
            Equal(owner.Attachment!.SessionId, first, "primary terminal metadata identifies the actual control history");
            Equal((await adapter.Start(input, cancellation)).IsSuccess, false, "a second Codex native owner is rejected before another process writes its home");
            Equal(adapter.Reset(new(workspace, state, Identity.Identifier())).IsSuccess, false, "context reset cannot archive live Codex native ownership");
            Equal((await owner.Inspect()).Value, false, "saved instructions do not leave idle room histories reported as busy");
            original = adapter.SavedContexts(workspace, state).Value;
            Equal(original.Count, 3, "all native identities are durably discoverable without a running process");
            await owner.DisposeAsync(); closed = true; Equal(owner.Lifetime.IsCancellationRequested, true, "closed owner retains a stable cancelled lifetime token");
            Equal((await owner.Inspect()).IsSuccess, false, "closed native ownership cannot claim healthy idle activity");
        }
        finally { if (!closed) await owner.DisposeAsync(); }
        var auth = Path.Combine(source, "auth.json");
        try
        {
            PrivateFiles.Write(auth, "{\"OPENAI_API_KEY\":\"inert-fixture-current-account\",\"tokens\":null,\"last_refresh\":null}"u8, 65536);
            var resumed = await adapter.Start(input, cancellation);
            Equal(resumed.IsSuccess, true, resumed.IsSuccess ? "a fresh process resumes the same control history and current native account" : resumed.Error.Message);
            await using (var current = resumed.Value)
            {
                Equal(current.SessionId, first, "controller resume preserves the exact native control history");
                foreach (var saved in original.Where(value => value.Context != "control"))
                    Equal((await current.Conversation(saved.Context)).Value.SessionId, saved.SessionId, "room resume preserves each exact saved native history");
                Equal(Encoding.UTF8.GetString(PrivateFiles.Read(Path.Combine(state, ".codex/auth.json"), 65536)), Encoding.UTF8.GetString(PrivateFiles.Read(auth, 65536)),
                    "every owned-runtime resume recopies current host authentication bytes");
            }
            var shared = await adapter.Start(input with { HistoryMode = NativeHistoryMode.Shared }, cancellation);
            Equal(shared.IsSuccess, true, shared.IsSuccess ? "an explicit history-mode change retains the earlier native histories" : shared.Error.Message); string sharedId;
            await using (var current = shared.Value)
            {
                sharedId = current.SessionId;
                Equal((await current.Conversation("!room-a:example.test")).Value.SessionId, sharedId, "shared mode uses one context across rooms");
                Equal((await current.Conversation("!room-b:example.test")).Value.SessionId, sharedId, "shared mode does not create room-specific histories");
                Equal((await current.Attachments()).Value.Count, 4, "switching history mode does not discard saved room identities");
            }
            var nativeHome = Path.Combine(state, ".codex"); var nativeFiles = Directory.GetFiles(Path.Combine(nativeHome, "sessions"), "*.jsonl", SearchOption.AllDirectories);
            var resetId = Identity.Identifier(); var reset = adapter.Reset(new(workspace, state, resetId));
            Equal(reset.IsSuccess, true, reset.IsSuccess ? "explicit reset archives native bindings without deleting user histories" : reset.Error.Message);
            Equal(adapter.Reset(new(workspace, state, resetId)).IsSuccess, true, "reset identity is repeatable after completion");
            Equal(adapter.SavedContexts(workspace, state).Value.Count, 0, "reset removes only active history bindings");
            Equal(nativeFiles.All(File.Exists), true, "native saved conversations survive context reset");
            Equal(File.Exists(Path.Combine(nativeHome, "crossfire-archive", resetId, ContextRegistry.FileName)), true, "the exact prior registry remains in a private archive");
            var fresh = await adapter.Start(input with { HistoryMode = NativeHistoryMode.Shared, AllowNewHistory = true }, cancellation);
            Equal(fresh.IsSuccess, true, fresh.IsSuccess ? "only explicit fresh start creates the replacement context" : fresh.Error.Message);
            await using (var current = fresh.Value) Equal(current.SessionId != sharedId && current.SessionId != first, true, "fresh start uses a new native context, not a renamed old one");
        }
        finally { PrivateFiles.DeletePrivate(auth); }
    }
}
