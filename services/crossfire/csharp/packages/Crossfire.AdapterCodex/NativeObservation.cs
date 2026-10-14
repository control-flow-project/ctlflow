using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public sealed class NativeObservation(RuntimeHooks hooks, Func<string> session, Func<long> now) : IDisposable
{
    private sealed record Streamed(IncrementalHash Digest) { public int Length { get; set; } }
    private readonly Dictionary<string, Streamed> streams = new(StringComparer.Ordinal);
    private readonly Dictionary<string, long> offsets = new(StringComparer.Ordinal);
    private IReadOnlyList<RuntimeSetting> settings = [];
    public void Configure(CodexOptions configured, JsonElement selected, string? version)
    {
        var values = new[] { ("model", CodexJson.String(selected, "model")), ("model_reasoning_effort", CodexJson.String(selected, "reasoningEffort")),
            ("sandbox_mode", selected.TryGetProperty("sandbox", out var sandbox) ? CodexJson.String(sandbox, "type") : null),
            ("approval_policy", Scalar(selected.GetProperty("approvalPolicy"))), ("native_version", version) };
        var input = configured.Native(); var result = values.Select(value => new RuntimeSetting(value.Item1, input.TryGetProperty(value.Item1, out var original) ? Scalar(original) : null, value.Item2)).ToList();
        if (configured.Questions is not null) result.Add(new("features.default_mode_request_user_input", configured.Questions.Value ? "true" : "false", null)); settings = result;
    }
    private static string? Scalar(JsonElement value) => value.ValueKind switch { JsonValueKind.String => value.GetString(), JsonValueKind.Null => null, JsonValueKind.Object => "[object Object]", _ => value.GetRawText() };
    public void State(string state, string? error = null) => hooks.Observe?.Invoke(new NativeState("codex", session(), null, state, now(), settings, error));
    private void Output(string id, string text, string? stream = null)
    {
        if (text.Length == 0) return;
        var offset = offsets.GetValueOrDefault(id); offsets[id] = checked(offset + Encoding.UTF8.GetByteCount(text)); hooks.Observe?.Invoke(new NativeOutput(session(), id + ":" + offset, stream, text));
    }
    private static string Text(JsonElement value, string name) => CodexJson.String(value, name) ?? throw new InvalidDataException("Invalid native observation text");
    public void Event(NativeEvent value)
    {
        var parameters = value.Parameters; if (CodexJson.String(parameters, "threadId") != session()) return;
        var usage = Usage(value, session()); if (usage is not null) hooks.Usage?.Invoke(usage);
        switch (value.Method)
        {
            case "thread/status/changed":
                var status = parameters.GetProperty("status"); var type = Text(status, "type");
                if (type == "active")
                {
                    var flags = status.GetProperty("activeFlags"); if (flags.ValueKind != JsonValueKind.Array || flags.EnumerateArray().Any(flag => flag.ValueKind != JsonValueKind.String || flag.GetString() is not ("waitingOnApproval" or "waitingOnUserInput"))) throw new InvalidDataException("Invalid native activity flags");
                    State(flags.EnumerateArray().Any(flag => flag.GetString() == "waitingOnApproval") ? "waiting-approval" : flags.EnumerateArray().Any(flag => flag.GetString() == "waitingOnUserInput") ? "waiting-answer" : "working");
                }
                else if (type is "idle" or "notLoaded" or "systemError") State(type == "idle" ? "idle" : "unavailable");
                else throw new InvalidDataException("Invalid native thread activity state");
                break;
            case "turn/started": State("working"); break;
            case "turn/completed":
                var turn = parameters.GetProperty("turn"); var completed = Text(turn, "status"); if (completed is not ("completed" or "failed" or "interrupted")) throw new InvalidDataException("Invalid native turn completion state");
                var message = turn.GetProperty("error").ValueKind == JsonValueKind.Null ? null : Text(turn.GetProperty("error"), "message");
                State(completed == "failed" ? "failed" : "idle", message is { Length: > 4000 } ? message[..4000] : message); Clear(); break;
            case "item/agentMessage/delta":
            case "item/commandExecution/outputDelta":
                var id = Text(parameters, "itemId"); var delta = Text(parameters, "delta");
                if (!streams.TryGetValue(id, out var current)) { current = new(IncrementalHash.CreateHash(HashAlgorithmName.SHA256)); streams.Add(id, current); }
                current.Length = checked(current.Length + delta.Length); current.Digest.AppendData(MemoryMarshal.AsBytes(delta.AsSpan())); Output(id, delta, id); break;
            case "item/mcpToolCall/progress": Output(Text(parameters, "itemId"), Text(parameters, "message"), Text(parameters, "itemId")); break;
            case "item/started":
            case "item/completed": Item(value.Method, parameters.GetProperty("item")); break;
        }
    }
    private void Item(string method, JsonElement item)
    {
        var type = Text(item, "type");
        if (type is not ("agentMessage" or "commandExecution" or "fileChange" or "mcpToolCall" or "dynamicToolCall" or "webSearch" or "imageGeneration")) return;
        var id = Text(item, "id"); if (id.Length == 0) throw new InvalidDataException("Native observation requires an exact item identity");
        if (method == "item/started")
        {
            if (type == "commandExecution") Output(id + ":command", CodexJson.Object(writer => { writer.WriteString("command", Text(item, "command")); writer.WriteString("cwd", Text(item, "cwd")); }).GetRawText());
            return;
        }
        string? complete = type == "agentMessage" ? Text(item, "text") : type == "commandExecution" ? item.GetProperty("aggregatedOutput").ValueKind == JsonValueKind.Null ? null : Text(item, "aggregatedOutput") : null;
        if (streams.Remove(id, out var prefix))
        {
            using (prefix.Digest)
            {
                if (complete is not null && complete.Length >= prefix.Length && SHA256.HashData(MemoryMarshal.AsBytes(complete.AsSpan(0, prefix.Length))).AsSpan().SequenceEqual(prefix.Digest.GetHashAndReset())) complete = complete[prefix.Length..];
            }
        }
        if (complete is not null) Output(id, complete, id);
        if (type == "fileChange") Output(id, item.GetProperty("changes").GetRawText());
        var names = type switch
        {
            "mcpToolCall" => new[] { "tool", "result", "error" }, "dynamicToolCall" => ["tool", "contentItems", "success"],
            "webSearch" => ["query", "action", "results"], "imageGeneration" => ["status", "revisedPrompt", "result", "failure"], _ => []
        };
        if (names.Length > 0) Output(id, CodexJson.Object(writer =>
        {
            if (type is "webSearch" or "imageGeneration") writer.WriteString("tool", type);
            foreach (var name in names) { writer.WritePropertyName(name); item.GetProperty(name).WriteTo(writer); }
        }).GetRawText());
    }
    private static UsageSample? Usage(NativeEvent value, string session)
    {
        if (value.Method != "thread/tokenUsage/updated" || !value.Parameters.TryGetProperty("tokenUsage", out var usage) || usage.ValueKind != JsonValueKind.Object
            || !usage.TryGetProperty("total", out var total) || total.ValueKind != JsonValueKind.Object) return null;
        static long? Number(JsonElement value, string name) => value.TryGetProperty(name, out var number) && CodexJson.Integer(number, out var count) && count >= 0 ? count : null;
        var input = Number(total, "inputTokens"); var cached = Number(total, "cachedInputTokens"); var output = Number(total, "outputTokens"); var tokens = Number(total, "totalTokens");
        if (!total.TryGetProperty("reasoningOutputTokens", out var reason)) return null; var reasoning = Validation.NullableInteger(reason);
        var writes = total.TryGetProperty("cacheWriteInputTokens", out var write) ? Validation.NullableInteger(write) : Result<long?>.Success(null);
        if (input is null || cached is null || output is null || tokens is null || !reasoning.IsSuccess || !writes.IsSuccess || cached > input || reasoning.Value > output || writes.Value > input) return null;
        return new("codex", session, new(input.Value, cached.Value, writes.Value, output.Value, reasoning.Value, tokens.Value));
    }
    private void Clear() { foreach (var stream in streams.Values) stream.Digest.Dispose(); streams.Clear(); offsets.Clear(); }
    public void Dispose() => Clear();
}
