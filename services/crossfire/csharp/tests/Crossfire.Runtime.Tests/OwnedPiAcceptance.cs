using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterPi;
using Crossfire.AdapterRuntime;
using Crossfire.AgentCore;
using Crossfire.Domain;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class OwnedPiAcceptance
{
    private static async Task Idle(RuntimeConnection connection, CancellationToken cancellation)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation); deadline.CancelAfter(TimeSpan.FromSeconds(15));
        for (;;) { deadline.Token.ThrowIfCancellationRequested(); var state = await connection.TurnControl!.ActiveTurn(); if (!state.IsSuccess) throw new IOException(state.Error.Message); if (state.Value is null) return; await Task.Delay(20, deadline.Token); }
    }
    private static IReadOnlyList<JsonElement> Entries(string home, string history)
    { var output = new List<JsonElement>(); NativeHistory.Since(home, history, null, output.Add); return output; }
    private static int Markers(IReadOnlyList<JsonElement> values, string name) => values.Count(value => PiValues.Text(value, "customType") == name);
    private static async Task<OwnedRuntimeConnection> Start(OwnedRuntimeAdapter adapter, OwnedRuntimeInput input, CancellationToken cancellation)
    { var value = await adapter.Start(input, cancellation); Equal(value.IsSuccess, true, value.IsSuccess ? "actual owned Pi runtime starts" : value.Error.Message); return value.Value; }
    public static async Task Verify()
    {
        var binary = Environment.GetEnvironmentVariable("CROSSFIRE_TEST_PI_EXECUTABLE")!; var directory = PrivateFiles.Directory(Path.Combine(Path.GetTempPath(), "crossfire-owned-pi-" + Identity.Identifier()));
        try
        {
            await using var provider = await PiProvider.Start(directory); using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(120)); var cancellation = stop.Token;
            var workspace = PrivateFiles.Directory(Path.Combine(directory, "workspace")); var state = PrivateFiles.Directory(Path.Combine(directory, "state"));
            var events = new ConcurrentQueue<RuntimeObservationEvent>(); var usage = new ConcurrentQueue<UsageSample>(); var decisions = Channel.CreateUnbounded<RuntimeDecision>(); var waitQuestion = false;
            var hooks = new RuntimeHooks(async (decision, scope) =>
            {
                decisions.Writer.TryWrite(decision);
                if (waitQuestion) { await Task.Delay(Timeout.InfiniteTimeSpan, scope); throw new InvalidOperationException("Cancelled question cannot produce an answer"); }
                return Result<JsonElement>.Success(PiValues.Object(writer => { writer.WriteStartObject("answers"); writer.WriteStartObject(decision.Request); writer.WriteStartArray("answers"); writer.WriteStringValue("B"); writer.WriteEndArray(); writer.WriteEndObject(); writer.WriteEndObject(); }));
            }, Usage: usage.Enqueue, Observe: events.Enqueue);
            var options = ModelAcceptance.Json("{\"provider\":\"fixture\",\"model\":\"fixture-model\",\"thinking_level\":\"high\"}"); var adapter = PiRuntime.Create(binary, provider.Host);
            var input = new OwnedRuntimeInput("native-pi-proof", "Native Pi proof", workspace, state, "Private initial Pi instructions. Preserve the original source and use explicit room tools.", options, hooks);
            foreach (var mode in new[] { NativeHistoryMode.Shared, NativeHistoryMode.PerRoom })
            { var missing = await adapter.Start(input with { HistoryMode = mode }, cancellation); Equal(!missing.IsSuccess && missing.Error.Code == "missing", true, "Pi ordinary resume cannot create an initial history in either mode"); }
            Equal(provider.Requests, 0, "missing-history rejection never invokes a model");
            foreach (var invalid in new[] { "{\"provider\":\"fixture\",\"model\":\"missing\"}", "{\"provider\":\"fixture\",\"model\":\"plain-model\",\"thinking_level\":\"high\"}", "{\"provider\":\"fixture\",\"model\":\"fixture-model\",\"thinking_level\":\"max\"}", "{\"sandbox_mode\":\"danger-full-access\"}" })
                Equal((await adapter.Inspect(new(workspace, state, ModelAcceptance.Json(invalid)), cancellation)).IsSuccess, false, "Pi rejects unavailable native configuration without substitution");
            Equal((await adapter.Inspect(new(workspace, state, options), cancellation)).IsSuccess, true, "actual Pi admission uses the inert advertised provider"); Equal(provider.Requests, 0, "Pi inspection and model/effort admission make zero model calls");
            var current = await Start(adapter, input with { AllowNewHistory = true }, cancellation); string session; string home = Path.Combine(state, ".pi"); string history;
            try
            {
                session = current.SessionId; Equal(current.Attachment is null && (await current.Attachments()).Value.Count == 0, true, "Pi does not fabricate unsupported TUI attachment");
                history = PiState.History(home, PiState.Read(home).Value.Bindings.Single()); var initial = Entries(home, history); Equal(Markers(initial, "crossfire-instructions"), 1, "Pi records one native instruction revision with zero model turns");
                Equal(initial.Any(value => PiValues.Text(value, "type") == "message"), false, "Pi startup does not manufacture a user message");
                Equal((await adapter.Start(input, cancellation)).IsSuccess, false, "a second owner cannot write this Pi home");
            }
            finally { await current.DisposeAsync(); }
            Equal(current.Lifetime.IsCancellationRequested, true, "Pi owner retains a stable stopped lifetime");
            current = await Start(adapter, input, cancellation);
            try
            {
                Equal(current.SessionId, session, "Pi resumes the exact native history after process restart"); Equal(Markers(Entries(home, history), "crossfire-instructions"), 1, "unchanged instructions do not append on resume");
                provider.NextTool("bash", ModelAcceptance.Json("{\"command\":\"printf native-pi-tools\",\"timeout\":5}"));
                var delivered = await current.Deliver("Run the inert tool. Retain azure 452.", "pi-tool", cancellation); Equal(delivered.IsSuccess, true, delivered.IsSuccess ? "Pi delivery requires native history evidence" : delivered.Error.Message);
                Equal(current.Acknowledge(["pi-tool"]).IsSuccess, true, "Pi exact receipt acknowledgement"); await Idle(current, cancellation); var first = await provider.Calls.ReadAsync(cancellation); var second = await provider.Calls.ReadAsync(cancellation);
                Equal(first.Input.GetRawText().Contains(input.Instructions, StringComparison.Ordinal), true, "Pi native provider receives the effective initial instructions");
                Equal(second.Input.GetRawText().Contains("native-pi-tools", StringComparison.Ordinal), true, "actual Pi executes its inert native tool");
                Equal(events.OfType<NativeOutput>().Any(value => value.Text.Contains("native-pi-tools", StringComparison.Ordinal)), true, "native tool output reaches the shared owner-observation port");
                Equal(usage.Last().Tokens, new TokenCounts(10, 4, 0, 6, null, 16), "Pi reports exact cumulative cached and output usage with unknown reasoning");
                provider.Hold(); Equal((await current.Deliver("Hold this actual native turn.", "pi-held", cancellation)).IsSuccess, true, "Pi confirms input before model completion"); current.Acknowledge(["pi-held"]);
                var held = await provider.Calls.ReadAsync(cancellation); Equal(held.Held, true, "Pi interruption operates during real held provider I/O"); var turn = await current.TurnControl!.ActiveTurn(); Equal(turn.Value is not null, true, "Pi captures the exact active run");
                Equal((await current.TurnControl.Interrupt(turn.Value!, admission: new(InputPriority.Steering, cancellation))).Value, "interrupted", "Pi synchronously interrupts the captured native run"); held.Release.TrySetResult();
                provider.Hold(); Equal((await current.Deliver("Apply this steering instruction.", "pi-steering", cancellation, InputPriority.Steering)).IsSuccess, true, "replacement Pi input receives its own native receipt"); current.Acknowledge(["pi-steering"]);
                var replacement = await provider.Calls.ReadAsync(cancellation); Equal((await current.TurnControl.Interrupt(turn.Value!)).Value, "inactive", "an old captured Pi run cannot interrupt its replacement"); replacement.Release.TrySetResult(); await Idle(current, cancellation);
                provider.NextTool("crossfire_question", ModelAcceptance.Json("{\"title\":\"Pick an option\",\"prompt\":\"Which route?\",\"options\":[\"A\",\"B\",\"C\"]}"));
                Equal((await current.Deliver("Ask the owner for the route.", "pi-question", cancellation)).IsSuccess, true, "Pi question input is confirmed"); current.Acknowledge(["pi-question"]); await Idle(current, cancellation);
                var question = await decisions.Reader.ReadAsync(cancellation); Equal(question.Runtime, "pi", "native owner question uses the shared runtime interface"); Equal(string.Join(',', question.Questions![0].Options.Select(value => value.Label)), "A,B,C", "the original Pi choices reach the owner unchanged");
                await provider.Calls.ReadAsync(cancellation); var answer = await provider.Calls.ReadAsync(cancellation); Equal(answer.Input.GetRawText().Contains("\\\"answer\\\":\\\"B\\\"", StringComparison.Ordinal), true, "the selected owner answer returns to the original native tool");
                waitQuestion = true; provider.NextTool("crossfire_question", ModelAcceptance.Json("{\"title\":\"Await owner\",\"prompt\":\"Answer needed\",\"options\":[\"A\",\"B\"]}"));
                Equal((await current.Deliver("Ask and await an owner answer.", "pi-await", cancellation)).IsSuccess, true, "input awaiting a native owner answer is confirmed"); current.Acknowledge(["pi-await"]); await decisions.Reader.ReadAsync(cancellation); await provider.Calls.ReadAsync(cancellation);
                var asking = await current.TurnControl.ActiveTurn(); Equal(asking.Value is not null, true, "the waiting question belongs to a captured active run");
                Equal((await current.TurnControl.Interrupt(asking.Value!)).Value, "interrupted", "steering cancels a pending Pi question without answering it");
                Equal((await current.Deliver("Continue without treating interruption as approval.", "pi-question-steer", cancellation)).IsSuccess, true, "Pi continues after a deliberately cancelled owner question"); current.Acknowledge(["pi-question-steer"]); await Idle(current, cancellation); await provider.Calls.ReadAsync(cancellation);
                Equal(events.OfType<NativeState>().Any(value => value.State == "failed"), false, "intentional Pi interruption is not reported as a crash");
            }
            finally { await current.DisposeAsync(); }
            await ResumeAndRecover(adapter, input, provider, home, history, session, cancellation);
            await Contexts(adapter, input, provider, cancellation);
        }
        finally { Directory.Delete(directory, recursive: true); }
    }
    private static async Task ResumeAndRecover(OwnedRuntimeAdapter adapter, OwnedRuntimeInput input, PiProvider provider, string home, string history, string session, CancellationToken cancellation)
    {
        PrivateFiles.Write(Path.Combine(provider.Host, "auth.json"), "{\"fixture\":{\"type\":\"api_key\",\"key\":\"replacement-inert-account\"}}"u8, 65536);
        var changed = input with { Instructions = "Updated native Pi role instructions. Preserve private room boundaries." }; var current = await Start(adapter, changed, cancellation);
        try
        {
            Equal(current.SessionId, session, "changed role instructions retain exact Pi identity"); Equal(Markers(Entries(home, history), "crossfire-instructions"), 2, "changed Pi instructions use the same native instruction producer");
            Equal(File.ReadAllText(Path.Combine(home, "auth.json")), File.ReadAllText(Path.Combine(provider.Host, "auth.json")), "every Pi resume recopies the current host account");
            Equal((await current.Deliver("Use the retained historical fact.", "pi-retained", cancellation)).IsSuccess, true, "Pi saves confirmed input before process shutdown"); await Idle(current, cancellation);
            var call = await provider.Calls.ReadAsync(cancellation); Equal(call.Input.GetRawText().Contains("azure 452", StringComparison.Ordinal) && call.Input.GetRawText().Contains(changed.Instructions, StringComparison.Ordinal), true, "actual Pi resumes both prior conversation history and updated role instructions");
        }
        finally { await current.DisposeAsync(); }
        var before = provider.Requests; current = await Start(adapter, changed, cancellation);
        try { Equal((await current.Recover("Use the retained historical fact.", "pi-retained", cancellation)).Value, true, "restart recovers the exact confirmed Pi input without replay"); current.Acknowledge(["pi-retained"]); Equal(provider.Requests, before, "confirmed Pi recovery makes no model call"); }
        finally { await current.DisposeAsync(); }
        var file = PiHistories.Receipt(home, "shared"); var boundary = NativeHistory.Capture(home, history)!;
        const string original = "Origin room !original:fixture; sender @human:fixture; timestamp 1800000000000. Finish the original still-authorized task.";
        using (var journal = NativeJournal<PiInput>.Open(file, session, PiInputCodec.Codec).Value) Equal(journal.Prepare(new(original, "pi-unpublished", boundary, false)).IsSuccess, true, "crash-before-publication preserves exact attributed Pi input");
        current = await Start(adapter, changed, cancellation);
        try
        {
            Equal((await current.Settle(cancellation)).Value, true, "uncertain Pi input is resolved through verified native continuation"); current.Acknowledge(["pi-unpublished"]); await Idle(current, cancellation);
            var files = Directory.GetFiles(Path.Combine(home, "receipts/resume-input")); Equal(files.Length, 1, "Pi restart retains one exact original context file"); Equal(File.ReadAllText(files[0]), original, "Pi last-input file preserves all source attribution verbatim");
            var call = await provider.Calls.ReadAsync(cancellation); Equal(call.Input.GetRawText().Contains("[Crossfire session restarted]", StringComparison.Ordinal) && call.Input.GetRawText().Contains(Path.GetFileName(files[0]), StringComparison.Ordinal), true, "Pi continuation references retained original without fabricating prior delivery");
        }
        finally { await current.DisposeAsync(); }
        current = await Start(adapter, changed, cancellation);
        try { Equal((await current.Settle(cancellation)).Value, false, "a completed Pi recovery is not replayed on another restart"); }
        finally { await current.DisposeAsync(); }
    }
    private static async Task Contexts(OwnedRuntimeAdapter adapter, OwnedRuntimeInput input, PiProvider provider, CancellationToken cancellation)
    {
        var isolated = input with { StateDirectory = PrivateFiles.Directory(Path.Combine(Path.GetDirectoryName(input.StateDirectory)!, "per-room")), HistoryMode = NativeHistoryMode.PerRoom, AllowNewHistory = true };
        var current = await Start(adapter, isolated, cancellation); IReadOnlyList<SavedRuntimeContext> saved;
        try
        {
            using var admission = new CancellationTokenSource(); var first = (await current.Conversation("!first:fixture", new(InputPriority.Steering, admission.Token))).Value;
            await admission.CancelAsync(); Equal(first.Lifetime.IsCancellationRequested || current.Lifetime.IsCancellationRequested, false, "completed Pi room admission is detached from the native engine lifetime");
            var second = (await current.Conversation("!second:fixture")).Value; Equal(first.SessionId != second.SessionId && first.SessionId != current.SessionId && second.SessionId != current.SessionId, true, "Pi per-room histories and private control use distinct native identities");
            Equal((await first.Deliver("Private first-room fact violet 51.", "pi-first", cancellation)).IsSuccess, true, "Pi publishes to the first room history"); first.Acknowledge(["pi-first"]); await Idle(first, cancellation); await provider.Calls.ReadAsync(cancellation);
            Equal((await second.Deliver("Only second-room information.", "pi-second", cancellation)).IsSuccess, true, "Pi publishes to the second room history"); second.Acknowledge(["pi-second"]); await Idle(second, cancellation);
            Equal((await provider.Calls.ReadAsync(cancellation)).Input.GetRawText().Contains("violet 51", StringComparison.Ordinal), false, "Pi per-room context does not copy private first-room history");
            saved = adapter.SavedContexts(isolated.Workspace, isolated.StateDirectory).Value; Equal(saved.Count, 3, "Pi saved context discovery exposes exact native identities without a new writer");
            Equal(adapter.Reset(new(isolated.Workspace, isolated.StateDirectory, Identity.Identifier())).IsSuccess, false, "Pi cannot reset a live native history owner");
        }
        finally { await current.DisposeAsync(); }
        var resumedInput = isolated with { AllowNewHistory = false }; current = await Start(adapter, resumedInput, cancellation);
        try
        {
            Equal(adapter.SavedContexts(isolated.Workspace, isolated.StateDirectory).Value.SequenceEqual(saved), true, "Pi primary restart preserves the complete saved context order and identities");
            foreach (var binding in saved.Where(value => value.Context != "control")) Equal((await current.Conversation(binding.Context)).Value.SessionId, binding.SessionId, "Pi restart resumes every exact retained room identity");
        }
        finally { await current.DisposeAsync(); }
        var reset = Identity.Identifier(); Equal(adapter.Reset(new(isolated.Workspace, isolated.StateDirectory, reset)).IsSuccess, true, "Pi explicit reset archives native histories"); Equal(adapter.Reset(new(isolated.Workspace, isolated.StateDirectory, reset)).IsSuccess, true, "Pi reset is idempotent by reset identity");
        Equal(Directory.GetFiles(Path.Combine(isolated.StateDirectory, ".pi/archive", reset, "histories")).Length, 3, "Pi reset preserves every native history in its private archive");
        current = await Start(adapter, isolated, cancellation); string fresh;
        try { fresh = current.SessionId; Equal(saved.Any(value => value.SessionId == fresh), false, "explicit fresh start cannot reuse an archived native identity"); }
        finally { await current.DisposeAsync(); }
        var home = Path.Combine(isolated.StateDirectory, ".pi"); var registry = PiState.Read(home).Value; File.Delete(PiState.History(home, registry.Bindings.Single()));
        var missing = await adapter.Start(resumedInput, cancellation); Equal(!missing.IsSuccess && missing.Error.Code == "missing", true, "a missing saved Pi native history never becomes a fresh replacement");
    }
}
