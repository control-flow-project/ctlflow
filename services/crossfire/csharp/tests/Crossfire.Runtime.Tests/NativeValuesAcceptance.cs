using System.Text.Json;
using Crossfire.AdapterCodex;
using Crossfire.AdapterPi;
using Crossfire.AgentCore;
using Crossfire.Domain;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class NativeValuesAcceptance
{
    private static bool Rejected(Action action) { try { action(); return false; } catch (Exception error) when (error is IOException or InvalidDataException or JsonException or InvalidOperationException) { return true; } }
    public static void Verify()
    {
        Decisions(); Observation(); Pi(); Terminal();
    }
    private static NativeRequest Request(string method, string parameters) => new(ModelAcceptance.Json("7"), method, ModelAcceptance.Json(parameters));
    private static void Decisions()
    {
        const string session = "native-session";
        var approval = NativeDecisions.Decode(Request("item/commandExecution/requestApproval", "{\"threadId\":\"native-session\",\"turnId\":\"turn\",\"itemId\":\"item\",\"command\":\"printf controlled\",\"cwd\":\"/tmp\",\"availableDecisions\":[\"accept\",\"decline\",\"cancel\"]}"), session, null);
        Equal(approval.IsSuccess, true, "Codex command approval preserves its exact native command, item and choices"); Equal(approval.Value.Request, "[\"number\",7]", "numeric native decision identity is not confused with text");
        Equal(approval.Value.Choices.Count, 3, "only native-offered permission choices are exposed"); Equal(NativeDecisions.Denial(approval.Value)!.Value.GetProperty("decision").GetString(), "decline", "native denial does not fabricate an approval");
        Equal(NativeDecisions.ValidAnswer(approval.Value, ModelAcceptance.Json("{\"decision\":\"accept\"}")), true, "a native offered approval is valid");
        Equal(NativeDecisions.ValidAnswer(approval.Value, ModelAcceptance.Json("{\"decision\":\"acceptForSession\"}")), false, "an unavailable native approval scope is rejected");
        Equal(NativeDecisions.Decode(Request("item/commandExecution/requestApproval", "{\"threadId\":\"another\"}"), session, null).IsSuccess, false, "native decisions cannot cross histories");
        Equal(NativeDecisions.Decode(Request("unexpected/approval", "{\"threadId\":\"native-session\",\"turnId\":\"turn\",\"itemId\":\"item\"}"), session, null).IsSuccess, false, "unknown native approval is not silently answered");
        var changes = ModelAcceptance.Json("[{\"path\":\"evidence.txt\",\"diff\":" + ProtocolJson.Quote(new string('x', 26036)) + "}]");
        Equal(NativeDecisions.Decode(Request("item/fileChange/requestApproval", "{\"threadId\":\"native-session\",\"turnId\":\"turn\",\"itemId\":\"item\"}"), session, changes).IsSuccess, true, "large file change evidence is not subject to the obsolete 12k approval-message limit");
        var questions = NativeDecisions.Decode(Request("item/tool/requestUserInput", "{\"threadId\":\"native-session\",\"turnId\":\"turn\",\"itemId\":\"item\",\"isBlocking\":true,\"autoResolutionMs\":500,\"questions\":[{\"id\":\"route\",\"header\":\"Route\",\"question\":\"Which route?\",\"isSecret\":false,\"isOther\":false,\"options\":[{\"label\":\"A\",\"description\":\"First\"},{\"label\":\"B\",\"description\":\"Second\"}]}]}"), session, null);
        Equal(questions.IsSuccess, true, "native owner questions retain original attribution"); Equal(questions.Value.ExpiresMs, 500L, "native question expiry is retained");
        Equal(NativeDecisions.ValidAnswer(questions.Value, ModelAcceptance.Json("{\"answers\":{\"route\":{\"answers\":[\"B\"]}}}")), true, "question answers target the original native question");
        foreach (var invalid in new[] { "{}", "{\"answers\":{\"wrong\":{\"answers\":[\"B\"]}}}", "{\"answers\":{\"route\":{\"answers\":[\"C\"]}}}", "{\"answers\":{\"route\":{\"answers\":[\"A\",\"B\"]}}}" })
            Equal(NativeDecisions.ValidAnswer(questions.Value, ModelAcceptance.Json(invalid)), false, "invalid or ambiguous native owner answers are rejected");
    }
    private static void Observation()
    {
        var output = new List<RuntimeObservationEvent>(); var usage = new List<UsageSample>(); var hooks = new RuntimeHooks((_, _) => ValueTask.FromResult(Results.Fail<JsonElement>("forbidden", "No question")), usage.Add, Observe: output.Add);
        using var native = new NativeObservation(hooks, () => "session", () => 42);
        void Event(string method, string tail) => native.Event(new(method, ModelAcceptance.Json("{\"threadId\":\"session\"," + tail + "}")));
        native.Event(new("item/agentMessage/delta", ModelAcceptance.Json("{\"threadId\":\"other\",\"itemId\":\"other\",\"delta\":\"private\"}")));
        Equal(output.Count, 0, "Codex observations cannot cross native histories");
        Event("item/reasoning/textDelta", "\"delta\":\"Hidden reasoning\""); Event("item/completed", "\"item\":{\"type\":\"reasoning\",\"id\":\"thinking\",\"text\":\"Hidden reasoning\"}"); Equal(output.Count, 0, "Codex hidden reasoning does not become terminal observation");
        Event("item/agentMessage/delta", "\"itemId\":\"text\",\"delta\":\"hello \""); Event("item/agentMessage/delta", "\"itemId\":\"text\",\"delta\":\"world\"");
        Event("item/completed", "\"item\":{\"id\":\"text\",\"type\":\"agentMessage\",\"text\":\"hello world!\"}"); Equal(string.Concat(output.OfType<NativeOutput>().Select(value => value.Text)), "hello world!", "Codex completion forwards only unstreamed visible output");
        Event("thread/status/changed", "\"status\":{\"type\":\"active\",\"activeFlags\":[\"waitingOnUserInput\"]}"); Equal(output.OfType<NativeState>().Last().State, "waiting-answer", "Codex native question state remains visible");
        Event("thread/status/changed", "\"status\":{\"type\":\"active\",\"activeFlags\":[\"waitingOnApproval\"]}"); Equal(output.OfType<NativeState>().Last().State, "waiting-approval", "Codex native permission state remains visible");
        Equal(Rejected(() => Event("thread/status/changed", "\"status\":{\"type\":\"active\",\"activeFlags\":[\"unknown\"]}")), true, "unknown native activity flags are not reported as idle");
        Event("thread/tokenUsage/updated", "\"tokenUsage\":{\"total\":{\"inputTokens\":10,\"cachedInputTokens\":4,\"outputTokens\":6,\"reasoningOutputTokens\":null,\"totalTokens\":16}}");
        Equal(usage.Single().Tokens, new TokenCounts(10, 4, null, 6, null, 16), "unknown native usage subsets stay unknown rather than dropping the sample");
        Event("thread/tokenUsage/updated", "\"tokenUsage\":{\"total\":{\"inputTokens\":10,\"cachedInputTokens\":4,\"cacheWriteInputTokens\":11,\"outputTokens\":6,\"reasoningOutputTokens\":2,\"totalTokens\":16}}"); Equal(usage.Count, 1, "invalid native token subsets are not published as measurements");
        Event("item/completed", "\"item\":{\"id\":\"files\",\"type\":\"fileChange\",\"changes\":[{\"path\":\"report.txt\",\"diff\":" + ProtocolJson.Quote(new string('x', 26036)) + "}]}");
        Equal(output.OfType<NativeOutput>().Last().Text.Length > 26036, true, "ordinary native file-change output is not cut off by approval-message limits");
        Event("turn/completed", "\"turn\":{\"status\":\"failed\",\"error\":{\"message\":" + ProtocolJson.Quote(string.Concat(Enumerable.Repeat("😀", 3000))) + "}}");
        var bounded = output.OfType<NativeState>().Last().ErrorMessage!;
        Equal(bounded, string.Concat(Enumerable.Repeat("😀", 1000)), "native failure retains whole Unicode scalars");
        Equal(System.Text.Encoding.UTF8.GetByteCount(bounded), 4000, "native error bound is UTF-8 bytes, not UTF-16 units");
    }
    private static void Pi()
    {
        var output = new List<RuntimeObservationEvent>(); var usage = new List<UsageSample>(); var hooks = new RuntimeHooks((_, _) => ValueTask.FromResult(Results.Fail<JsonElement>("forbidden", "No question")), usage.Add, Observe: output.Add);
        using var native = new PiObservation(hooks, () => "pi-session", () => 42); var meter = new PiUsage(hooks, () => "pi-session");
        native.Event(ModelAcceptance.Json("{\"type\":\"message_start\",\"message\":{\"role\":\"assistant\"}}"));
        native.Event(ModelAcceptance.Json("{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"thinking_delta\",\"delta\":\"secret thinking\"}}")); Equal(output.Count, 0, "Pi thinking traces are excluded by native event type");
        native.Event(ModelAcceptance.Json("{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"Visible\"}}"));
        native.Event(ModelAcceptance.Json("{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"thinking\",\"thinking\":\"hidden\"},{\"type\":\"text\",\"text\":\"Visible\"}]}}")); Equal(output.Count, 1, "Pi final visible text is not repeated after streaming");
        native.Event(ModelAcceptance.Json("{\"type\":\"message_start\",\"message\":{\"role\":\"assistant\"}}")); native.Event(ModelAcceptance.Json("{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"Original\"}}"));
        Equal(Rejected(() => native.Event(ModelAcceptance.Json("{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Changed\"}]}}"))), true, "Pi changed completion cannot silently replace already streamed native output");
        meter.Initialize(ModelAcceptance.Json("{\"sessionId\":\"pi-session\",\"tokens\":{\"input\":5,\"cacheRead\":2,\"cacheWrite\":3,\"output\":4}}")); Equal(usage.Single().Tokens, new TokenCounts(10, 2, 3, 4, null, 14), "Pi cached usage starts with the native cumulative baseline");
        meter.Event(ModelAcceptance.Json("{\"type\":\"entry_appended\",\"entry\":{\"type\":\"compaction\",\"usage\":{\"input\":1,\"cacheRead\":1,\"cacheWrite\":0,\"output\":2}}}")); Equal(usage.Last().Tokens.Total, 18L, "Pi compaction usage is included once as a native increment");
        Equal(Rejected(() => meter.Initialize(ModelAcceptance.Json("{\"sessionId\":\"other\",\"tokens\":{}}"))), true, "Pi usage cannot be rebound to a different native session");
        foreach (var invalid in new[] { "{\"type\":\"extension_ui_request\",\"id\":\"q\",\"method\":\"select\",\"title\":\"Title\",\"options\":[\"A\",\"A\"]}", "{\"type\":\"extension_ui_request\",\"id\":\"q\",\"method\":\"confirm\",\"title\":\"Title\",\"timeout\":-1}", "{\"type\":\"extension_ui_request\",\"id\":\"q\",\"method\":\"confirm\",\"title\":\"Bad\\u0000Title\"}" })
            Equal(PiQuestions.Decode(ModelAcceptance.Json(invalid), "session", "turn").IsSuccess, false, "invalid Pi native question is rejected without inventing an answer");
        var confirm = PiQuestions.Decode(ModelAcceptance.Json("{\"type\":\"extension_ui_request\",\"id\":\"q\",\"method\":\"confirm\",\"title\":\"Title\\nPrompt\",\"timeout\":25}"), "session", "turn");
        Equal(string.Join(',', confirm.Value.Questions![0].Options.Select(value => value.Label)), "Yes,No", "Pi confirmation exposes exactly yes and no"); Equal(confirm.Value.ExpiresMs, 25L, "Pi native question timeout is preserved"); Equal(confirm.Value.Questions[0].Prompt, "Prompt", "Pi multiline title preserves the actual prompt");
        Equal(PiQuestions.Decode(ModelAcceptance.Json("{\"type\":\"extension_ui_request\",\"id\":\"q\",\"method\":\"editor\",\"title\":\"Edit\",\"prefill\":\"Exact prefill\"}"), "session", "turn").Value.Questions![0].AllowText, true, "Pi editor questions use the common free-text decision contract");
    }
    private static void Terminal()
    {
        var input = new RuntimeAttachment("codex", "42693342-3d57-40aa-9555-47eb5efab6bb", "/tmp/private project", new Dictionary<string, string>
            { ["endpoint"] = "ws://127.0.0.1:3456", ["home"] = "/tmp/private-home", ["tokenFile"] = "/tmp/token'file", ["binary"] = "/usr/local/bin/codex", ["path"] = "/usr/bin:/bin" });
        var command = CodexTerminal.Create().Command(input); Equal(command.IsSuccess, true, "Codex terminal adapter formats the actual saved remote attachment");
        Equal(command.Value.Contains("'--cd' '/tmp/private project' 'resume' '42693342-3d57-40aa-9555-47eb5efab6bb'", StringComparison.Ordinal), true, "terminal attachment resumes the exact native history without a new context");
        Equal(command.Value.Contains("'\\''", StringComparison.Ordinal), true, "terminal argument quoting does not turn a path into shell control");
        Equal(CodexTerminal.Create().Command(input with { Runtime = "pi" }).IsSuccess, false, "unsupported runtime attachment is not emulated as Codex");
        foreach (var endpoint in new[] { "ws://example.com", "ws://127.0.0.1/?token=secret", "ws://user:secret@127.0.0.1/", "ws://127.0.0.1/path", "http://127.0.0.1" })
        { var fields = new Dictionary<string, string>(input.Connection) { ["endpoint"] = endpoint }; Equal(CodexTerminal.Create().Command(input with { Connection = fields }).IsSuccess, false, "terminal capability refuses non-private native endpoints"); }
    }
}
